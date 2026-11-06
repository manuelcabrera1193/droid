import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { DeviceSelectionStore } from "../src/config.js";
import { buildOpenInvocation, startDeviceUi, type DeviceUiAdb, type DeviceUiEmulators } from "../src/ui.js";

const adb: DeviceUiAdb = {
  adbCommand: "/portable/sdk/platform-tools/adb",
  async listDevices() {
    return [
      { serial: "emulator-5554", state: "device", model: "Pixel_8" },
      { serial: "phone-offline", state: "offline", model: "Phone" },
    ];
  },
  async screenshot(serial) {
    return Buffer.from(`png:${serial}`);
  },
};

const emulators: DeviceUiEmulators = {
  command: "/portable/sdk/emulator/emulator",
  async listAvds() {
    return ["Pixel_8_API_35"];
  },
  async startAvd() {},
};

describe("local device selector UI", () => {
  it("builds portable browser launch invocations without a shell", () => {
    assert.deepEqual(buildOpenInvocation("http://127.0.0.1:3210", "darwin"), {
      command: "open",
      args: ["http://127.0.0.1:3210"],
    });
    assert.deepEqual(buildOpenInvocation("http://127.0.0.1:3210", "win32"), {
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "http://127.0.0.1:3210"],
    });
    assert.throws(() => buildOpenInvocation("https://example.com", "linux"), /non-local/u);
  });

  it("serves a localhost dashboard and protects state changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-ui-"));
    const selection = new DeviceSelectionStore(join(root, "config.json"));
    const ui = await startDeviceUi({
      port: 0,
      adb,
      emulators,
      selection,
      token: "test-token",
    });

    try {
      assert.match(ui.url, /^http:\/\/127\.0\.0\.1:\d+$/u);
      const page = await fetch(ui.url);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Seleccionar dispositivo/u);
      assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/u);
      const browserSource = await fetch(`${ui.url}/app.js`).then((response) => response.text());
      assert.match(browserSource, /active \? "Deseleccionar" : "Usar este"/u);
      assert.match(browserSource, /active \? automatic\(\) : choose\(device\.serial\)/u);
      assert.match(browserSource, /No se pudo conectar al servicio local/u);
      assert.match(browserSource, /async function reconnect\(\)/u);
      assert.match(browserSource, /\$\("refresh"\)\.addEventListener\("click", reconnect\)/u);
      assert.match(browserSource, /catch \{[\s\S]*?previewKey = "";/u);
      assert.match(browserSource, /URL\.revokeObjectURL\(previewObjectUrl\)/u);
      assert.match(browserSource, /const generation = \+\+previewGeneration/u);
      assert.match(browserSource, /generation !== previewGeneration/u);
      assert.match(browserSource, /URL\.revokeObjectURL\(nextUrl\)/u);

      const rejectedState = await fetch(`${ui.url}/api/state`);
      assert.equal(rejectedState.status, 403);
      const state = await fetch(`${ui.url}/api/state`, {
        headers: { "x-local-android-token": "test-token" },
      }).then((response) => response.json()) as {
        devices: Array<{ serial: string }>;
        avds: string[];
        selectedDevice?: string;
      };
      assert.equal(state.devices[0]?.serial, "emulator-5554");
      assert.deepEqual(state.avds, ["Pixel_8_API_35"]);
      assert.equal(state.selectedDevice, undefined);

      const rejected = await fetch(`${ui.url}/api/selection`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serial: "emulator-5554" }),
      });
      assert.equal(rejected.status, 403);

      const selected = await fetch(`${ui.url}/api/selection`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-android-token": "test-token",
          origin: ui.url,
        },
        body: JSON.stringify({ serial: "emulator-5554" }),
      });
      assert.equal(selected.status, 200);
      assert.equal(selection.getSelectedSerial(), "emulator-5554");

      const rejectedScreenshot = await fetch(`${ui.url}/api/screenshot?device=emulator-5554`);
      assert.equal(rejectedScreenshot.status, 403);
      const screenshot = await fetch(`${ui.url}/api/screenshot?device=emulator-5554`, {
        headers: { "x-local-android-token": "test-token" },
      });
      assert.equal(screenshot.headers.get("content-type"), "image/png");
      assert.equal(Buffer.from(await screenshot.arrayBuffer()).toString(), "png:emulator-5554");

      const cleared = await fetch(`${ui.url}/api/selection`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-android-token": "test-token",
          origin: ui.url,
        },
        body: JSON.stringify({ serial: null }),
      });
      assert.equal(cleared.status, 200);
      assert.equal(selection.getSelectedSerial(), undefined);
    } finally {
      await ui.close();
    }
  });

  it("rejects DNS-rebinding Host headers", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-ui-host-"));
    const ui = await startDeviceUi({
      port: 0,
      adb,
      emulators,
      selection: new DeviceSelectionStore(join(root, "config.json")),
      token: "test-token",
    });

    try {
      const target = new URL(ui.url);
      const status = await new Promise<number>((resolve, reject) => {
        const outgoing = request(
          {
            hostname: target.hostname,
            port: target.port,
            path: "/",
            headers: { host: "attacker.example" },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        outgoing.on("error", reject);
        outgoing.end();
      });
      assert.equal(status, 403);
    } finally {
      await ui.close();
    }
  });

  it("rejects selecting an unavailable or unauthorized serial", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-ui-invalid-"));
    const ui = await startDeviceUi({
      port: 0,
      adb,
      emulators,
      selection: new DeviceSelectionStore(join(root, "config.json")),
      token: "test-token",
    });

    try {
      const response = await fetch(`${ui.url}/api/selection`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-android-token": "test-token",
          origin: ui.url,
        },
        body: JSON.stringify({ serial: "phone-offline" }),
      });
      assert.equal(response.status, 409);
    } finally {
      await ui.close();
    }
  });
});
