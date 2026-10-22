import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {load, connected, frame, hex, status, temperature, reading, flush, deferred, plain, SERVICE} from './difluid-harness.mjs';

test('R2 manifest selects a sensor on its own service, alongside the Bookoo scale', () => {
  const manifest = JSON.parse(readFileSync(new URL('../difluid-r2.reaplugin/manifest.json', import.meta.url)));
  assert.equal(manifest.id, 'difluid-r2.reaplugin');
  assert.deepEqual(manifest.permissions, ['transport.ble', 'log']);
  assert.equal(manifest.drivers[0].type, 'sensor');
  assert.deepEqual(manifest.drivers[0].ble.match.serviceUuids, [SERVICE]);
  assert.equal(manifest.drivers[0].ble.match.name, undefined);
});

test('protocol readiness requires the temperature-unit reply, without changing the device settings', async () => {
  const host = await load(), driver = host.create(), link = host.session(driver, {autoAck: false});
  let ready = false;
  link.connection.then(() => {ready = true;});
  await flush();
  assert.deepEqual(link.writes, [hex('DF DF 01 00 00 BF')]);
  assert.equal(ready, false);
  await link.emit(frame(1, 0, [1]));
  await link.connection;
  assert.equal(ready, true);
  assert.deepEqual(link.published.at(-1).reading, {});
  assert.equal(host.clock.timers.size, 0);
  await link.disconnect();
});

test('manufacturer example gives signed TDS, 32-bit refractive index and Fahrenheit converted to Celsius', async () => {
  const {link} = await connected();
  assert.deepEqual(plain(await link.execute({commandId: 'measure'})), {started: true});
  assert.deepEqual(link.writes.at(-1), hex('DF DF 03 00 00 C1'));
  await link.emit(status(11));
  await link.emit(temperature);
  await link.emit(reading);
  const result = (await link.execute({commandId: 'getReading'})).reading;
  assert.equal(result.tds, 0.79);
  assert.equal(result.refractiveIndex, 1.33437);
  assert.ok(Math.abs(result.temperatureC - 26.08333333333333) < 1e-9);
  assert.ok(Math.abs(result.prismTemperatureC - 26.16666666666666) < 1e-9);
  assert.equal(result.temperature, result.temperatureC);
  assert.equal(link.published.at(-1).measuring, false);
  await link.emit(frame(3, 0, [2, 255, 249, 0, 2, 8, 166]));
  assert.equal(link.published.at(-1).reading.tds, -0.07);
  await link.disconnect();
});

test('Celsius and missing temperatures are explicit; a previous test temperature is never carried forward', async () => {
  const {link} = await connected();
  await link.emit(status(11));
  await link.emit(frame(3, 0, [1, 0, 250, 1, 4, 0]));
  await link.emit(reading);
  assert.equal(link.published.at(-1).reading.temperatureC, 25.5);
  await link.execute({commandId: 'measure'});
  assert.deepEqual(link.published.at(-1).reading, {});
  await link.emit(reading);
  assert.equal(link.published.at(-1).reading.temperatureC, undefined);
  assert.deepEqual(link.published.at(-1).temperatures, {});
  await link.disconnect();
});

test('invalid frames, unrelated functions and calibration results cannot become a coffee reading', async () => {
  const {link} = await connected();
  const before = link.published.length;
  for (const data of [reading.slice(0, -1), [...reading, 0], [0, ...reading.slice(1)],
    [...reading.slice(0, -1), 0], frame(0, 0, [2, 0, 79, 0, 2, 9, 61]),
    frame(3, 2, [2, 0, 0, 0, 2, 9, 61]), frame(3, 0, [2, 0, 79]),
    frame(3, 0, [1, 0, 250, 0, 250, 9]), frame(3, 0, [0, 255])]) await link.emit(data);
  for (const data of ['?', '====', 'AAAA=AAA', 'A'.repeat(400)]) await link.emitBase64(data);
  assert.equal(link.published.length, before);
  await assert.rejects(link.execute({commandId: 'getReading'}), /no.*reading/i);
  await link.disconnect();
});

test('device errors clear the active request, and unknown errors remain visible', async () => {
  for (const [data, expected] of [[[2, 1], 'test_error'], [[2, 2], 'calibration_failed'],
    [[2, 3], 'no_liquid'], [[2, 4], 'beyond_range'], [[3, 7], 'hardware_error_7']]) {
    const {link, host} = await connected();
    await link.execute({commandId: 'measure'});
    await link.emit(frame(3, 254, data));
    assert.equal(link.published.at(-1).error, expected);
    assert.equal(link.published.at(-1).measuring, false);
    assert.equal(host.clock.timers.size, 0);
    await link.disconnect();
  }
  const {link} = await connected();
  await link.emit(frame(3, 255, [255, 255, 255, 255]));
  assert.equal(link.published.at(-1).error, 'unknown_error');
  await link.disconnect();
});

test('passive average tests publish the aggregate rather than an intermediate sample', async () => {
  const {link} = await connected();
  await link.emit(frame(3, 1, [0, 4, 0]));
  await link.emit(frame(3, 1, [1, 0, 250, 0, 250, 0]));
  await link.emit(frame(3, 1, [2, 0, 79, 0, 2, 9, 61]));
  assert.deepEqual(link.published.at(-1).reading, {});
  await link.emit(frame(3, 1, [3, 0, 80, 0, 2, 9, 61]));
  assert.deepEqual(link.published.at(-1).reading, {});
  await link.emit(frame(3, 1, [4, 0, 251, 0, 253, 3, 3]));
  await link.emit(frame(3, 1, [0, 6, 0]));
  assert.equal(link.published.at(-1).reading.tds, 0.8);
  assert.ok(Math.abs(link.published.at(-1).reading.temperatureC - 25.2) < 1e-9);
  await link.execute({commandId: 'measure'});
  await link.disconnect();
});

test('a reading without a new temperature packet cannot inherit the last completed reading temperature', async () => {
  const {link} = await connected();
  await link.emit(temperature);
  await link.emit(reading);
  assert.equal(typeof link.published.at(-1).reading.temperatureC, 'number');
  await link.emit(reading);
  assert.equal(link.published.at(-1).reading.temperatureC, undefined);
  await link.disconnect();
});

test('idle R2 has no scale-style silence watchdog, while a timed-out measurement retires once', async () => {
  const {host, link} = await connected({}, {MeasurementTimeoutMs: 15000});
  await host.clock.tick(300000);
  assert.equal(link.reported, 0);
  await link.execute({commandId: 'measure'});
  await host.clock.tick(15000);
  assert.equal(link.reported, 1);
  assert.match(host.logs.at(-1), /timed out/i);
  await host.clock.tick(60000);
  assert.equal(link.reported, 1);
  const before = link.published.length;
  await link.emit(reading);
  assert.equal(link.published.length, before);
  await assert.rejects(link.execute({commandId: 'measure'}), /not connected/i);
  await link.disconnect();
  assert.equal(host.clock.timers.size, 0);
});

test('handshake timeout, absent service, subscription errors and disconnect reject initialization', async () => {
  const host = await load(), driver = host.create(), link = host.session(driver, {autoAck: false});
  await flush();
  await host.clock.tick(3000);
  await assert.rejects(link.connection, /initialization.*timed out/i);
  assert.equal(host.clock.timers.size, 0);
  for (const options of [{services: []}, {subscribeError: new Error('subscribe failed')}]) {
    const link = host.session(host.create(), options);
    await assert.rejects(link.connection);
  }
  const next = host.session(host.create(), {autoAck: false});
  await flush();
  await next.drop();
  await assert.rejects(next.connection, /disconnect/i);
  assert.equal(host.clock.timers.size, 0);
});

test('measurement start reserves its slot before any async work and validates commands', async () => {
  const {link} = await connected();
  await assert.rejects(link.execute({commandId: 'calibrate'}), /unsupported/i);
  await assert.rejects(link.execute({commandId: 'measure', params: {samples: 2}}), /parameter/i);
  const first = link.execute({commandId: 'measure'});
  await assert.rejects(link.execute({commandId: 'measure'}), /busy/i);
  await first;
  assert.equal(link.writes.filter(data => data[2] === 3).length, 1);
  await link.disconnect();
});

test('write failures propagate, retire once and allow a fresh session on reconnect', async () => {
  const {link, host, driver} = await connected({write: data => {
    if (data[2] === 3) throw new Error('write failed');
  }});
  await assert.rejects(link.execute({commandId: 'measure'}), /write failed/);
  assert.equal(link.reported, 1);
  const fresh = host.session(driver);
  await fresh.connection;
  await link.emit(reading);
  assert.deepEqual(fresh.published.at(-1).reading, {});
  await fresh.execute({commandId: 'measure'});
  await fresh.emit(reading);
  assert.equal(fresh.published.at(-1).reading.tds, 0.79);
  await fresh.disconnect();
});

test('unload cancels startup and in-flight writes without waiting for a stuck GATT promise', async () => {
  const stalled = deferred();
  const {host, link} = await connected({write: data => data[2] === 3 ? stalled.promise : undefined});
  const pending = link.execute({commandId: 'measure'});
  await flush();
  host.plugin.onUnload();
  await assert.rejects(pending, /not connected/i);
  assert.equal(host.clock.timers.size, 0);
  stalled.resolve();
  await flush();
  const nextHost = await load(), next = nextHost.session(nextHost.create(), {autoAck: false});
  await flush();
  nextHost.plugin.onUnload();
  await assert.rejects(next.connection, /not connected/i);
});

test('settings reject invalid and unbounded deadlines', async () => {
  for (const value of [null, '45000', false, 1, 1000.5, 180001]) {
    await assert.rejects(load({MeasurementTimeoutMs: value}), /MeasurementTimeoutMs/);
  }
});

for (const realBridge of [false, true]) {
  test(`${realBridge ? 'actual Decaid v0.9.0 bridge' : 'fake GATT'}: four independent R2 sessions, stale callbacks and unload`, async () => {
    const host = await load({}, {realBridge});
    assert.equal(host.links.length, 0);
    const links = [];
    for (let i = 0; i < 4; i++) {
      const link = host.session(host.create());
      await link.connection;
      links.push(link);
    }
    await links[0].execute({commandId: 'measure'});
    await links[0].emit(reading);
    assert.equal(links[0].published.at(-1).reading.tds, 0.79);
    assert.deepEqual(links[1].published.at(-1).reading, {});
    await links[0].disconnect();
    const before = links[0].published.length;
    await links[0].emit(reading);
    assert.equal(links[0].published.length, before);
    await links[1].execute({commandId: 'measure'});
    assert.equal(links[2].writes.length, 1);
    host.plugin.onUnload();
    for (const link of links.slice(1)) await assert.rejects(link.execute({commandId: 'measure'}));
    assert.equal(host.clock.timers.size, 0);
  });
}
