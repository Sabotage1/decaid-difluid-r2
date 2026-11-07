# Changelog

## 0.2.0 — 2026-11-08

- Add `measureAverage({count})` to the Sensors API with strict integer validation
  for 2–10 native device measurements; existing `measure({})` remains a single test.
- Send one native R2 Average command with the requested count and publish the
  final device aggregate through the existing snapshot stream and `getReading`.
- Keep single/average requests mutually exclusive and isolate their reply modes.
- Scale the total average deadline by the requested count without extending it
  for start/ongoing status notifications.
- Expand automated coverage to 26 R2 tests, including native frames for counts
  2, 3 and 10 through the actual Decaid JavaScript bridge.
- Record the project owner's November 8 report that the plugin was tested and
  found to work with a physical DiFluid R2 refractometer. The new counted-average
  command still requires its own hardware check.

## 0.1.0 — 2026-10-23

Initial public hardware-testing preview for Decaid 0.9.0 and DiFluid R2 Extract
firmware 2.1.2 or later.

- Local BLE sensor binding, protocol-readiness handshake and per-device session state.
- TDS, refractive index, Celsius/Fahrenheit temperature conversion, status and errors.
- Single-test `measure` command, completed-result `getReading` command and passive button tests.
- Average results wait for final device status rather than exposing intermediate results.
- Active-measurement timeout, busy checks and stale-session/unload handling.
- Sixteen automated protocol/bridge tests, verified plugin ZIP and SHA-256 checksums.

Physical R2, installed-Decaid and tablet/Bluetooth validation is still pending.
