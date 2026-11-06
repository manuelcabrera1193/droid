import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  encodeInputText,
  parseAdbDevices,
  resolveAdbCommand,
  selectDeviceSerial,
  validateDeviceSerial,
  validatePackageName,
} from "../src/adb.js";

describe("resolveAdbCommand", () => {
  it("prefers an explicit portable environment override", () => {
    assert.equal(
      resolveAdbCommand(
        { ANDROID_ADB_PATH: "/custom/platform-tools/adb", PATH: "/usr/bin" },
        "darwin",
        () => true,
      ),
      "/custom/platform-tools/adb",
    );
  });

  it("discovers adb below ANDROID_SDK_ROOT without depending on the repository path", () => {
    assert.equal(
      resolveAdbCommand(
        { ANDROID_SDK_ROOT: "/sdk" },
        "linux",
        (candidate) => candidate === "/sdk/platform-tools/adb",
      ),
      "/sdk/platform-tools/adb",
    );
  });

  it("falls back to adb from PATH", () => {
    assert.equal(resolveAdbCommand({}, "win32", () => false), "adb");
  });
});

describe("ADB device discovery", () => {
  const output = `List of devices attached\ntest-device-001 device usb:1-2 product:sample_product model:Sample_Phone device:sample_device transport_id:1\nemulator-5554 offline transport_id:2\n`;

  it("parses device metadata", () => {
    assert.deepEqual(parseAdbDevices(output), [
      {
        serial: "test-device-001",
        state: "device",
        product: "sample_product",
        model: "Sample_Phone",
        device: "sample_device",
        transportId: 1,
      },
      {
        serial: "emulator-5554",
        state: "offline",
        transportId: 2,
      },
    ]);
  });

  it("uses the only authorized device automatically", () => {
    assert.equal(selectDeviceSerial(parseAdbDevices(output)), "test-device-001");
  });

  it("requires an explicit serial when multiple devices are authorized", () => {
    assert.throws(
      () =>
        selectDeviceSerial([
          { serial: "one", state: "device" },
          { serial: "two", state: "device" },
        ]),
      /Multiple authorized Android devices/,
    );
  });
});

describe("safe Android inputs", () => {
  it("encodes spaces without invoking a local shell", () => {
    assert.equal(encodeInputText("hello world@example.com"), "hello%sworld@example.com");
  });

  it("rejects remote-shell metacharacters", () => {
    assert.throws(() => encodeInputText("hello; reboot"), /unsupported characters/);
    assert.throws(() => encodeInputText("$(id)"), /unsupported characters/);
    assert.throws(() => encodeInputText("literal%s"), /unsupported characters/);
    assert.throws(() => encodeInputText("hello?"), /unsupported characters/);
    assert.throws(() => encodeInputText("wow!"), /unsupported characters/);
  });

  it("accepts Android package identifiers and rejects command fragments", () => {
    assert.equal(validatePackageName("com.android.settings"), "com.android.settings");
    assert.throws(() => validatePackageName("com.app;reboot"), /Invalid Android package/);
  });

  it("rejects option-like or shell-shaped device serials", () => {
    assert.equal(validateDeviceSerial("192.0.2.10:5555"), "192.0.2.10:5555");
    assert.throws(() => validateDeviceSerial("serial --transport-id 2"), /Invalid ADB device serial/);
  });
});
