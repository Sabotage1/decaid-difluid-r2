# DiFluid R2 Extract driver for Decaid 0.9.0

Installable JavaScript Bluetooth sensor driver for **DiFluid R2 Extract firmware
2.1.2 or later**, using the documented local cleartext protocol. Implements TDS,
refractive index, prism/sample temperatures, measurement status and device errors.
It works alongside the BooKoo Mini scale plugin.

## Install

1. Download `difluid-r2-0.1.0.zip` from the [v0.1.0 GitHub release](https://github.com/Sabotage1/decaid-difluid-r2/releases/tag/v0.1.0) and transfer it to the tablet/device running Decaid.
2. Open **Plugins → cogwheel → Install plugin → ZIP file** and select the ZIP.
   Alternatively install the `difluid-r2.reaplugin` folder using **Folder snapshot**.
3. Load/enable **DiFluid R2 Refractometer**. Turn on the R2, close its connection
   in DiFluid Café or another app, and scan for devices in Decaid.
4. Connect the R2 supplied by this plugin. If it was already connected using
   Decaid's built-in R2 support, disconnect it and rescan first.
5. Start a test using the R2's physical button, or send the `measure` sensor
   command below. Read the completed result from the sensor snapshot stream.

Decaid 0.9.0 already contains a native R2 integration. This plugin provides an
independently installable alternative using its driver runtime. It overrides
native matching on subsequent discovery. Plugin and native device IDs differ;
unload this plugin and rescan to return to native support. Enable only one plugin
claiming the R2 service. No changes to Decaid itself are required.

The plugin matches the R2 service `000000ff-0000-1000-8000-00805f9b34fb`, allowing
renamed devices; it does not claim the Microbalance scale's `00ee` service. A
service match alone is not a firmware/model verification. Initialization requires
a valid temperature-unit response within three seconds. No firmware detection,
firmware update, cloud login or DiFluid API key is implemented. DiFluid documents
the cleartext channel as enabled by default on supported firmware; older devices
without it fail initialization rather than reporting an unverified connection.

## Use through Decaid's Sensors API

Get the current plugin sensor ID from `GET /api/v1/sensors` or
`GET /api/v1/devices`. Its stable identity starts with
`plugin:difluid-r2.reaplugin:difluid-r2:`. Encode that entire opaque ID once when
using it as a path component, for example with `encodeURIComponent(id)`.

Send this JSON to `POST /api/v1/sensors/<encoded-id>/execute`:

```json
{"commandId":"measure","params":{}}
```

The command returns `{"started":true}` after the acknowledged Bluetooth write.
It does **not** wait for the measurement. Decaid limits plugin invocations to ten
seconds, while R2 tests can take longer. Subscribe to
`/ws/v1/sensors/<encoded-id>/snapshot` **before** starting a test and wait for a
nonempty `reading` object, or poll the `getReading` command:

```json
{"commandId":"getReading","params":{}}
```

`getReading` returns `{"reading":{...}}` for the latest completed test on this
connection. It fails with `no_reading` before a result or during a new test.
Decaid may wrap these command results in its normal API response envelope.
Commands accept no parameters. A second `measure` while busy is rejected.

## Snapshot contract

Every published snapshot has five channels:

| Channel | Type | Meaning |
| --- | --- | --- |
| `reading` | object | Latest completed result; `{}` before a result, on new test, or error. |
| `temperatures` | object | Latest temperatures in this test, or `{}` if none arrived. |
| `status` | string | `idle`, `started`, `finished`, device status such as `average_ongoing`, or `error`. |
| `measuring` | boolean | Device/request status. A finished status can arrive before result data. |
| `error` | string | Empty on success; otherwise a device error such as `no_liquid`, `beyond_range` or `hardware_error_7`. |

A completed `reading` contains:

```json
{
  "tds": 0.79,
  "refractiveIndex": 1.33437,
  "temperature": 26.08333333333333,
  "temperatureC": 26.08333333333333,
  "prismTemperatureC": 26.16666666666666,
  "sampleTemperatureC": 26.0
}
```

TDS is percent, decoded as a signed 16-bit value divided by 100. Refractive index
uses the four bytes in DiFluid's example, divided by 100000. Temperatures are
normalized to Celsius from each packet's unit; `temperature` and `temperatureC`
are the mean of prism and sample temperatures, matching Decaid's native R2
convention. The plugin queries the unit during initialization and does not
change the R2's stored unit or other settings.

Temperature fields are omitted from `reading` if no temperature packet arrived
for that result. Old temperatures are not attached to a new reading. No zero
or synthetic timestamp is invented for missing measurements.

Decaid's plugin Sensor contract requires every declared channel in every
snapshot and does not support nullable number channels. The `reading` object
keeps unknown values absent while allowing status before a first measurement.
Skins consuming this plugin must read **`snapshot.reading.tds`**, rather than
the native driver's flat `snapshot.tds`. Installing the driver does not add a
skin tile, compute extraction yield, or save TDS to a shot automatically.

Physical-button single tests and passive average-test notifications are handled.
Average readings publish only after the device's final status, using the latest
aggregate; intermediate samples are not exposed as completed results. The
`measure` command always requests a single test. Calibration results are ignored
as coffee readings, and calibration/settings-changing commands are not exposed.

## Timeouts and connection behavior

**Measurement timeout (milliseconds)** defaults to `45000`; allowed integers are
`15000`–`180000`. It starts for an active test. An unanswered finished status
still has to deliver a result before this deadline. On timeout, the plugin logs
the failure, retires its session and reports disconnection to Decaid. Late
callbacks cannot publish or satisfy a later request on a replacement session.
Idle silence is normal for a refractometer and never triggers a disconnect.

Decaid owns physical scanning, connections, recovery, permissions and Bluetooth
teardown. The plugin does not run a scan/reconnect loop or send scale sleep,
power, tare or machine-control commands. Disconnect and unload cancel timers
and pending work; each R2 has independent session state.

## Validation

From the repository root, run `npm test` or `npm run build` with Node.js 20+.
There are no npm dependencies. The build checks syntax, runs the R2 tests,
packages the plugin with its license and README, verifies ZIP contents against
source, and writes `dist/SHA256SUMS`.

R2 tests cover manufacturer example packets, signed values, temperature units,
checksums/lengths, absent data, average results, errors, readiness, timeouts,
busy requests, write failures, unload and stale callbacks. Four simultaneous
instances are also tested through **Decaid v0.9.0's actual JavaScript BLE bridge**
with a simulated Dart/GATT boundary. These checks do not execute the Flutter
host, prove host binding quotas/permission UI, or exercise physical Bluetooth.

**No physical R2 or installed-Decaid test has been performed.** Before relying
on it, record R2 firmware, Decaid version and tablet/OS, then verify:

1. Discovery/connect alongside the BooKoo scale; the scale remains primary.
2. A physical-button test and an API-triggered single test, comparing TDS and
   refractive index with the R2 display or DiFluid Café.
3. Celsius and Fahrenheit settings; compare both temperatures with the device.
4. No-liquid/error handling and an average test if you use that device mode.
5. Power-off, reconnect, plugin unload/reload and tablet background/foreground.

## Sources and license

- [Decaid 0.9.0 driver announcement](https://decentespresso.com/blog/decaid_090bring_your_driver).
- [Pinned v0.9.0 plugin contract](https://github.com/decentespresso/decaid/blob/b9f9d0559106809a70dea2023f6bce34b5bdd3ca/doc/Plugins.md).
- [DiFluid R2 protocol and example frames](https://github.com/DiFluid/difluid-sdk-demo/blob/master/docs/protocolR2.md).
- [DiFluid frame/checksum format](https://github.com/DiFluid/difluid-sdk-demo/blob/master/docs/difluid-protocol.md).
- [Supported firmware and local cleartext-channel notes](https://github.com/DiFluid/difluid-sdk-demo/blob/master/README.md).

GPL-3.0-or-later. See LICENSE and COPYING. No DiFluid SDK implementation code
or cloud credentials are included.
