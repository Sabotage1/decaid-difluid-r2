// Copyright (C) 2026 Roy Ackerman.
// SPDX-License-Identifier: GPL-3.0-or-later

function createPlugin(host) {
  "use strict";

  const service = "000000ff-0000-1000-8000-00805f9b34fb";
  const characteristic = "0000aa01-0000-1000-8000-00805f9b34fb";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const sessions = new Set();
  const statuses = {
    0: "finished", 1: "calibration_finished", 4: "average_started",
    5: "average_ongoing", 6: "average_finished", 7: "loop_started",
    8: "loop_ongoing", 9: "loop_finished", 10: "test_ongoing",
    11: "started", 12: "calibration_started"
  };
  let unloaded = false;
  let measurementTimeout;

  function failure(message, code) {return Object.assign(new Error(message), {code});}
  function disconnected() {return failure("DiFluid R2 is not connected", "stale_session");}
  function unsigned16(data, at) {return data[at] * 256 + data[at + 1];}
  function signed16(data, at) {
    const value = unsigned16(data, at);
    return value >= 32768 ? value - 65536 : value;
  }
  function decode(encoded) {
    if (typeof encoded !== "string" || encoded.length < 8 || encoded.length > 28 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
    const bytes = [];
    for (let i = 0; i < encoded.length; i += 4) {
      const a = alphabet.indexOf(encoded[i]), b = alphabet.indexOf(encoded[i + 1]);
      const c = alphabet.indexOf(encoded[i + 2]), d = alphabet.indexOf(encoded[i + 3]);
      bytes.push((a << 2) | (b >> 4));
      if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2));
      if (d >= 0) bytes.push(((c & 3) << 6) | d);
    }
    if (bytes.length < 6 || bytes.length > 20 || bytes[0] !== 223 || bytes[1] !== 223 ||
        bytes.length !== bytes[4] + 6 ||
        (bytes.slice(0, -1).reduce((sum, byte) => sum + byte, 0) & 255) !== bytes[bytes.length - 1]) return null;
    return {func: bytes[2], command: bytes[3], data: bytes.slice(5, -1)};
  }
  function frame(func, command, data) {
    const bytes = [223, 223, func, command, data.length, ...data];
    bytes.push(bytes.reduce((sum, byte) => sum + byte, 0) & 255);
    return btoa(String.fromCharCode(...bytes));
  }
  function stop(state, error) {
    if (!state || state.stopped) return;
    state.stopped = true;
    state.ready = false;
    clearTimeout(state.initializationTimer);
    clearTimeout(state.measurementTimer);
    state.rejectReady(error || disconnected());
    state.end(error || disconnected());
    sessions.delete(state);
  }
  function live(state, promise) {
    if (state.stopped) return Promise.reject(disconnected());
    return Promise.race([promise, state.ended.then(error => {throw error;})]);
  }
  function report(state, error) {
    if (state.stopped) return;
    stop(state, error);
    host.log("[difluid-r2] " + error.message);
    state.session.reportDisconnected().catch(() => {});
  }
  function publish(state) {
    const snapshot = {
      reading: {...state.reading}, temperatures: {...state.temperatures},
      status: state.status, measuring: state.measuring, error: state.error
    };
    const publication = state.publications.then(() => {
      if (state.stopped) throw disconnected();
      return live(state, state.session.publish(snapshot));
    });
    state.publications = publication.catch(() => {});
    return publication;
  }
  function write(state, func, command, data = []) {
    const result = state.commands.then(() => {
      if (state.stopped) throw disconnected();
      return live(state, state.session.gatt.writeWithResponse(service, characteristic, frame(func, command, data)));
    });
    state.commands = result.catch(() => {});
    return result;
  }
  function beginMeasurement(state) {
    state.reading = {};
    state.temperatures = {};
    state.pendingTemperatures = {};
    state.pendingAverage = null;
    state.averageFinished = false;
    state.error = "";
    state.measuring = true;
    clearTimeout(state.measurementTimer);
    state.measurementTimer = setTimeout(() => report(state,
      failure("DiFluid R2 measurement timed out", "measurement_timeout")), measurementTimeout);
  }
  function finishMeasurement(state) {
    state.measuring = false;
    clearTimeout(state.measurementTimer);
    state.measurementTimer = null;
  }
  function acceptReading(state, data) {
    state.reading = {tds: signed16(data, 1) / 100,
      refractiveIndex: (data[3] * 16777216 + data[4] * 65536 + data[5] * 256 + data[6]) / 100000,
      ...state.pendingTemperatures};
    state.pendingTemperatures = {};
    state.status = "finished";
    state.error = "";
    finishMeasurement(state);
  }
  async function notification(state, encoded) {
    if (state.stopped) return;
    const packet = decode(encoded);
    if (!packet) return;
    const {func, command, data} = packet;
    if (func === 1 && command === 0 && data.length === 1 && data[0] <= 1) {
      state.unit = data[0];
      state.resolveReady();
      return;
    }
    if (func !== 3) return;
    if (command === 254 || command === 255) {
      if (command === 254 && data.length !== 2 || command === 255 && data.length !== 4) return;
      state.error = command === 255 ? "unknown_error" : data[0] === 3 ? "hardware_error_" + data[1]
        : data[0] === 2 ? ({1: "test_error", 2: "calibration_failed", 3: "no_liquid", 4: "beyond_range"}[data[1]] || "unknown_error_" + data[1])
        : "unknown_error";
      state.reading = {};
      state.temperatures = {};
      state.pendingTemperatures = {};
      state.pendingAverage = null;
      state.status = "error";
      finishMeasurement(state);
      await publish(state);
      return;
    }
    if (command !== 0 && command !== 1 || !data.length) return;
    if (data[0] === 0 && (data.length === 2 || data.length === 3) && statuses[data[1]]) {
      const code = data[1];
      if ([4, 7, 11].includes(code)) beginMeasurement(state);
      else if ([5, 8, 10].includes(code) && !state.measuring) beginMeasurement(state);
      state.status = statuses[code];
      if ([0, 6, 9].includes(code)) state.measuring = false;
      if (command === 1 && code === 6) {
        state.averageFinished = true;
        if (state.pendingAverage) acceptReading(state, state.pendingAverage);
      }
    } else if (data[0] === 1 && data.length === 6 && data[5] <= 1 ||
        command === 1 && data[0] === 4 && data.length === 7 && data[5] >= 1 && data[5] <= data[6] && data[6] <= 10) {
      if (data[0] === 1) state.unit = data[5];
      const convert = value => state.unit === 1 ? (value - 32) * 5 / 9 : value;
      const prism = convert(signed16(data, 1) / 10), sample = convert(signed16(data, 3) / 10);
      state.temperatures = {prismTemperatureC: prism, sampleTemperatureC: sample,
        temperatureC: (prism + sample) / 2, temperature: (prism + sample) / 2};
      state.pendingTemperatures = {...state.temperatures};
    } else if ((command === 0 && data[0] === 2 || command === 1 && data[0] === 3) && data.length === 7) {
      if (command === 1) {
        state.pendingAverage = data;
        if (!state.averageFinished) return;
      }
      acceptReading(state, data);
    } else return;
    await publish(state);
  }

  return {
    id: "difluid-r2.reaplugin",
    version: "0.1.0",
    onLoad(values) {
      const value = values && values.MeasurementTimeoutMs !== undefined ? values.MeasurementTimeoutMs : 45000;
      if (!Number.isInteger(value) || value < 15000 || value > 180000) {
        throw new Error("MeasurementTimeoutMs must be an integer between 15000 and 180000");
      }
      measurementTimeout = value;
      unloaded = false;
      return host.devices.bindDriver("difluid-r2", {
        create() {
          let active;
          return {
            vendor: "DiFluid",
            dataChannels: [
              {key: "reading", type: "object"}, {key: "temperatures", type: "object"},
              {key: "status", type: "string"}, {key: "measuring", type: "boolean"}, {key: "error", type: "string"}
            ],
            commands: [
              {id: "measure", name: "Measure TDS", description: "Start a single test. The result arrives on the sensor snapshot stream.",
                paramsSchema: {type: "object", additionalProperties: false},
                resultsSchema: {type: "object", properties: {started: {type: "boolean"}}, required: ["started"]}},
              {id: "getReading", name: "Get latest reading", description: "Read the completed result from this connection; fails if no result is available.",
                paramsSchema: {type: "object", additionalProperties: false},
                resultsSchema: {type: "object", properties: {reading: {type: "object"}}, required: ["reading"]}}
            ],
            async connect(session) {
              if (unloaded) throw disconnected();
              if (active && !active.stopped) throw new Error("DiFluid R2 is already connected");
              let resolveReady, rejectReady, end;
              const readiness = new Promise((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
              readiness.catch(() => {});
              const state = {session, stopped: false, ready: false, resolveReady, rejectReady,
                ended: new Promise(resolve => {end = resolve;}), end,
                commands: Promise.resolve(), publications: Promise.resolve(),
                reading: {}, temperatures: {}, pendingTemperatures: {}, pendingAverage: null,
                averageFinished: false, unit: 0, status: "idle", measuring: false, error: ""};
              active = state;
              sessions.add(state);
              state.initializationTimer = setTimeout(() => stop(state,
                failure("DiFluid R2 initialization timed out; check firmware and cleartext Bluetooth support", "initialization_timeout")), 3000);
              try {
                session.gatt.onDisconnect(() => stop(state, failure("DiFluid R2 disconnected", "link_lost")));
                const services = await live(state, session.gatt.discoverServices());
                if (state.stopped) throw disconnected();
                if (!services.includes(service)) throw new Error("DiFluid R2 service unavailable");
                await live(state, session.gatt.subscribe(service, characteristic, encoded => notification(state, encoded)));
                if (state.stopped) throw disconnected();
                await write(state, 1, 0);
                await readiness;
                if (state.stopped) throw disconnected();
                clearTimeout(state.initializationTimer);
                await publish(state);
                if (state.stopped) throw disconnected();
                state.ready = true;
              } catch (error) {stop(state, error); throw error;}
            },
            async disconnect() {stop(active);},
            async execute(request) {
              const state = active;
              if (!state || state.stopped || !state.ready) throw disconnected();
              const commandId = request && request.commandId, params = request && request.params;
              if (params != null && (typeof params !== "object" || Array.isArray(params) || Object.keys(params).length)) {
                throw failure("DiFluid R2 commands accept no parameters", "invalid_argument");
              }
              if (commandId === "getReading") {
                if (!Object.keys(state.reading).length) throw failure("DiFluid R2 has no completed reading", "no_reading");
                return {reading: {...state.reading}};
              }
              if (commandId !== "measure") throw failure("Unsupported DiFluid R2 command", "unsupported_operation");
              if (state.measuring || state.measurementTimer != null) throw failure("DiFluid R2 is busy", "busy");
              beginMeasurement(state);
              state.status = "started";
              try {
                await publish(state);
                await write(state, 3, 0);
                if (state.stopped) throw disconnected();
                return {started: true};
              } catch (error) {report(state, error); throw error;}
            }
          };
        }
      });
    },
    onUnload() {unloaded = true; for (const state of sessions) stop(state);}
  };
}
