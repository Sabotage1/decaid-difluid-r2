# DiFluid R2 Extract driver for Decaid

A community JavaScript Bluetooth sensor driver for **Decaid 0.9.0** and the
**DiFluid R2 Extract**, targeting R2 firmware **2.1.2 or later**. Install the
plugin without rebuilding or modifying Decaid.

**Hardware testing preview:** automated protocol and JavaScript bridge tests
pass, but this driver has not yet been tested with a physical R2 or an installed
Decaid app. Feedback from R2 owners is welcome through
[GitHub Issues](https://github.com/Sabotage1/decaid-difluid-r2/issues).

Decaid already includes native R2 support. This project is an independently
installable alternative built with its device-driver runtime, rather than a
claim to introduce the first R2 integration. It is a sensor driver; your primary
espresso scale can remain connected.

## Download and install

1. Open [release v0.1.0](https://github.com/Sabotage1/decaid-difluid-r2/releases/tag/v0.1.0)
   and download **`difluid-r2-0.1.0.zip`** from Assets. Use the plugin ZIP rather
   than GitHub's automatically generated source archive.
2. Transfer the ZIP to the device running **Decaid 0.9.0**.
3. Open **Plugins → cogwheel → Install plugin → ZIP file** and select the ZIP.
4. Load **DiFluid R2 Refractometer** from its three-dot menu.
5. Turn on your R2, disconnect it from DiFluid Café or any other app, then scan
   for devices in Decaid and connect the R2 supplied by this plugin. If Decaid
   already has a native R2 connection, disconnect it before rescanning.
6. Use the R2's physical test button, or the sensor API's `measure` command.

Only one enabled plugin should claim the R2. To return to Decaid's native
driver, unload this plugin, disconnect the R2 and rescan. The native and plugin
device IDs differ. Checksums are provided as the release's `SHA256SUMS` asset.

## What it does

- Receives TDS, refractive index, prism/sample temperatures, status and device errors.
- Converts Celsius/Fahrenheit packets to Celsius without changing stored device settings.
- Starts a single measurement with `measure`; `getReading` retrieves its completed result.
- Receives physical-button single tests and passive average-test results.
- Validates frame length/checksum, fences retired sessions and bounds active-test timeouts.
- Uses Decaid for BLE ownership, scanning, connection recovery and teardown.

It uses DiFluid's local cleartext Bluetooth protocol. No cloud login, API key or
network permission is required. The plugin requests only `transport.ble` and `log`.

## Using the data in a skin or integration

Get the sensor ID from `GET /api/v1/sensors`. Encode the entire ID once when
placing it in a path. Subscribe to `/ws/v1/sensors/<encoded-id>/snapshot` before
starting a test, then send this body to
`POST /api/v1/sensors/<encoded-id>/execute`:

```json
{"commandId":"measure","params":{}}
```

The result is `{"started":true}` inside Decaid's normal command response.
Measurement data arrives later in **`snapshot.reading.tds`** and related fields.
The native R2 driver uses a different, flat snapshot shape. This plugin does not
add a skin tile, calculate extraction yield or automatically attach TDS to shots.

Read the [complete driver guide](difluid-r2.reaplugin/README.md) for the snapshot
schema, command behavior, timeouts, protocol sources and physical test checklist.

## Build and test

Requires Node.js 20+ and the `zip`/`unzip` commands. No npm dependencies are needed.

```sh
git clone https://github.com/Sabotage1/decaid-difluid-r2.git
cd decaid-difluid-r2
npm run build
```

The build checks JavaScript syntax, runs **16 R2 tests**, creates
`dist/difluid-r2-0.1.0.zip`, verifies every ZIP entry against its source and writes
`dist/SHA256SUMS`. Run `npm test` to execute the tests alone.

Tests cover published manufacturer examples, signed TDS, 32-bit refractive index,
temperature conversion, missing data, invalid packets, average results, errors,
initialization, measurement deadlines, busy requests, reconnect, unload and stale
callbacks. Four independent sessions are exercised through Decaid v0.9.0's actual
JavaScript BLE bridge with a simulated Dart/GATT boundary. This does not execute
the Flutter host or validate real Bluetooth, tablet permissions or device firmware.

## Reporting hardware results

Please include your R2 firmware, Decaid version, tablet/OS, installation method,
discovery/connect result, physical-button and API-test results, TDS comparison,
temperature-unit setting, and reconnect/unload behavior. Include any relevant
Decaid plugin logs. See the guide's checklist before relying on it in your workflow.

## License and acknowledgements

GPL-3.0-or-later. See [LICENSE](LICENSE), [COPYING](COPYING), and
[source attribution](THIRD_PARTY.md). Thanks to Decent Espresso for the plugin
runtime and DiFluid for publishing the R2 protocol. This community project is not
an official DiFluid or Decent Espresso release.
