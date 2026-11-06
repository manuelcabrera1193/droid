import assert from "node:assert/strict";

import { AdbClient } from "../dist/src/adb.js";

const client = new AdbClient();
const devices = await client.listDevices();
const serial = await client.resolveSerial();
const info = await client.getDeviceInfo(serial);
const screenshot = await client.screenshot(serial);
const tree = await client.getUiTree(serial);

assert.deepEqual([...screenshot.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.match(tree, /^<\?xml/u);

process.stderr.write(
  `ADB device smoke passed: ${serial}; ${info["ro.product.model"] ?? "unknown model"}; ${devices.length} attached; ${screenshot.length} PNG bytes; ${tree.length} XML characters.\n`,
);
