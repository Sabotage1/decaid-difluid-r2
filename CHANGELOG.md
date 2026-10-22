# Changelog

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
