# Source attribution

The R2 driver is a community implementation by Roy Ackerman against Decaid's
BLE Sensor binding contract and DiFluid's published protocol. Its transport and
lifecycle structure follows the existing GPL BooKoo Mini plugin developed in
the original driver workspace, which derives from Decent Espresso's GPL reference
plugin. This repository and its installable plugin are GPL-3.0-or-later.

`test/fixtures/decaid-v0.9.0-ble-bridge.js` is the JavaScript string extracted
without modification from `lib/src/plugins/plugin_ble_bridge.dart` at Decaid
tag **v0.9.0**, commit **b9f9d0559106809a70dea2023f6bce34b5bdd3ca**:
[pinned source](https://github.com/decentespresso/decaid/blob/b9f9d0559106809a70dea2023f6bce34b5bdd3ca/lib/src/plugins/plugin_ble_bridge.dart).
Copyright (C) 2025-2026 Decent Espresso, GPL-3.0-or-later. The fixture is used
only in tests and is excluded from the installable plugin ZIP.

Protocol facts and example packets were checked against
[DiFluid/difluid-sdk-demo](https://github.com/DiFluid/difluid-sdk-demo), including
`docs/difluid-protocol.md`, `docs/protocolR2.md`, `README.md`, and `pages/device.vue`.
No DiFluid SDK implementation code, cloud credentials or encrypted-channel
implementation is included.

Related references:

- [Decaid v0.9.0 plugin contract](https://github.com/decentespresso/decaid/blob/b9f9d0559106809a70dea2023f6bce34b5bdd3ca/doc/Plugins.md).
- [Decaid reference BooKoo plugin](https://github.com/decentespresso/decaid/tree/v0.9.0/examples/plugins/bookoo-mini.reaplugin).
- [R2 protocol and manufacturer examples](https://github.com/DiFluid/difluid-sdk-demo/blob/master/docs/protocolR2.md).
