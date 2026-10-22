import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Clock, deferred, flush, plain} from './harness.mjs';

export {deferred, flush, plain};
export const SERVICE = '000000ff-0000-1000-8000-00805f9b34fb';
export const DATA = '0000aa01-0000-1000-8000-00805f9b34fb';
export const sourceUrl = new URL('../difluid-r2.reaplugin/plugin.js', import.meta.url);
export const encode = data => Buffer.from(data).toString('base64');
export const bytes = data => [...Buffer.from(data, 'base64')];
export function frame(func, command, data = []) {
  const body = [223, 223, func, command, data.length, ...data];
  return [...body, body.reduce((sum, byte) => (sum + byte) & 255, 0)];
}
export const hex = value => [...Buffer.from(value.replaceAll(' ', ''), 'hex')];
export const ack = frame(1, 0, [0]);
export const status = code => frame(3, 0, [0, code, 0]);
export const temperature = hex('DF DF 03 00 06 01 03 17 03 14 01 FA');
export const reading = hex('DF DF 03 00 07 02 00 4F 00 02 09 3D 61');

export async function load(settings = {}, {realBridge = false} = {}) {
  const clock = new Clock(), logs = [], links = [], handlers = new Map();
  let factory;
  const context = vm.createContext({
    pluginId: 'difluid-r2.reaplugin', pluginGeneration: 1,
    pluginBridgeToken: 'test', __deviceNonce: 'test', __deviceSeq: 0,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    __deviceSetHandlers: (handle, entry) => handlers.set(handle, entry),
    __deviceRemoveHandlers: handle => handlers.delete(handle),
    __deviceCall: async (type, payload) => {
      if (type === 'bindDriver') {factory = handlers.get(payload.registrationHandle); return {};}
      const link = links.find(item => item.handle === payload.registrationHandle);
      if (!link || link.retired || payload.authority && payload.authority !== link.authority) {
        throw Object.assign(new Error('Retired'), {code: 'stale_session'});
      }
      if (type === 'gatt') {
        if (payload.operation === 'discoverServices') return {value: [SERVICE]};
        if (payload.operation === 'subscribe') {
          assertGatt(payload.args);
          link.listener = payload.args.listener;
          return {value: {subscription: link.handle}};
        }
        if (payload.operation === 'write') {
          assertGatt(payload.args);
          if (payload.args.withResponse !== true) throw new Error('Expected acknowledged write');
          await link.write(payload.args.data);
          return {value: null};
        }
      }
      if (payload.session !== link.domainSession) throw new Error('Wrong domain session');
      if (type === 'blePublish') {await link.publish(payload.snapshot); return {};}
      if (type === 'bleDisconnected') {link.reported++; return {};}
      throw new Error('Unexpected bridge operation: ' + type);
    }
  });
  function assertGatt(args) {
    if (args.service !== SERVICE || args.characteristic !== DATA) throw new Error('Wrong GATT tuple');
  }
  if (realBridge) vm.runInContext(readFileSync(new URL('./fixtures/decaid-v0.9.0-ble-bridge.js', import.meta.url), 'utf8'), context);
  vm.runInContext(readFileSync(sourceUrl, 'utf8'), context);
  const host = {log: message => logs.push(message), devices: {bindDriver: realBridge
    ? vm.runInContext('__bindBleDriver', context)
    : async (id, value) => {if (id !== 'difluid-r2') throw new Error('Wrong driver'); factory = value;}}};
  const plugin = context.createPlugin(host);
  await plugin.onLoad(settings);
  function create() {
    if (!realBridge) return factory.create({name: 'DiFluid R2'});
    const handle = 'physical-' + links.length;
    const metadata = factory.handlers.create({registrationHandle: handle,
      device: {id: handle, name: 'DiFluid R2', advertisement: {name: 'DiFluid R2',
        nameComplete: true, serviceUuids: [SERVICE], servicesComplete: true}}});
    return {entry: handlers.get(handle), handle, ...plain(metadata)};
  }
  function session(driver, options = {}) {
    const subscribed = deferred();
    let callback, terminal;
    const link = {handle: driver.handle, authority: 'live-' + links.length,
      domainSession: 'domain-' + links.length, retired: false, writes: [], published: [], reported: 0,
      subscribed: subscribed.promise, async write(data) {
        const decoded = bytes(data);
        link.writes.push(decoded);
        await options.write?.(decoded);
        if (options.autoAck !== false && decoded[2] === 1) await link.emit(ack);
      }, async publish(snapshot) {
        for (const channel of driver.dataChannels) {
          const value = snapshot[channel.key];
          if (value === null || typeof value !== channel.type || channel.type === 'object' && Array.isArray(value)) {
            throw new Error('Invalid channel: ' + channel.key);
          }
        }
        if (Object.keys(snapshot).length !== driver.dataChannels.length) throw new Error('Incomplete snapshot');
        await options.publish?.(snapshot);
        if (link.retired) throw Object.assign(new Error('Retired'), {code: 'stale_session'});
        link.published.push(plain(snapshot));
      }, emit(data) {return link.emitBase64(encode(data));},
      emitBase64(data) {return realBridge
        ? driver.entry.handlers.bleEvent({session: link.authority, type: 'notification', listener: link.listener, data})
        : callback(data);},
      async drop() {
        link.retired = true;
        if (realBridge) await driver.entry.handlers.bleEvent({session: link.authority, type: 'disconnect'});
        else terminal?.();
      }
    };
    links.push(link);
    const fake = {gatt: {
      discoverServices: async () => options.services ?? [SERVICE],
      subscribe: async (service, characteristic, subscriber) => {
        assertGatt({service, characteristic});
        if (options.subscribeError) throw options.subscribeError;
        callback = subscriber;
        subscribed.resolve();
        if (options.duringSubscribe) await callback(encode(options.duringSubscribe));
        await options.subscriptionDelay;
        return {unsubscribe: async () => {}};
      },
      onDisconnect: subscriber => {terminal = subscriber;},
      writeWithResponse: async (service, characteristic, data) => {
        assertGatt({service, characteristic});
        return link.write(data);
      }
    }, publish: link.publish, reportDisconnected: async () => {link.reported++;}};
    const context = realBridge ? driver.entry.connectTransport('connect', {
      gattSession: link.authority, session: link.domainSession}) : fake;
    link.connection = (realBridge ? driver.entry.handlers : driver).connect(context);
    link.connection.catch(() => {});
    link.execute = command => (realBridge ? driver.entry.handlers : driver).execute(command);
    link.disconnect = async () => {await (realBridge ? driver.entry.handlers : driver).disconnect({}); await link.drop();};
    return link;
  }
  return {clock, logs, plugin, create, session, links};
}

export async function connected(options = {}, settings = {}, mode = {}) {
  const host = await load(settings, mode), driver = host.create(), link = host.session(driver, options);
  await link.connection;
  return {host, driver, link};
}
