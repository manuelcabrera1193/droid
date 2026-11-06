import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  DeviceSelectionStore,
  resolveUserConfigPath,
} from "../src/config.js";

describe("portable user configuration", () => {
  it("derives the config path from each operating system", () => {
    assert.equal(
      resolveUserConfigPath("darwin", "/portable/home", {}),
      "/portable/home/Library/Application Support/local-android-mcp/config.json",
    );
    assert.equal(
      resolveUserConfigPath("linux", "/portable/home", { XDG_CONFIG_HOME: "/portable/config" }),
      "/portable/config/local-android-mcp/config.json",
    );
    assert.equal(
      resolveUserConfigPath("win32", "C:\\Users\\portable", { LOCALAPPDATA: "C:\\Portable\\Data" }),
      "C:\\Portable\\Data\\local-android-mcp\\config.json",
    );
  });

  it("persists and clears the selected device atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-config-"));
    const configPath = join(root, "config.json");
    const store = new DeviceSelectionStore(configPath);

    assert.equal(store.getSelectedSerial(), undefined);
    await store.setSelectedSerial("emulator-5554");
    assert.equal(store.getSelectedSerial(), "emulator-5554");
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
      schemaVersion: 1,
      selectedDevice: "emulator-5554",
    });

    await store.setSelectedSerial(undefined);
    assert.equal(store.getSelectedSerial(), undefined);
  });

  it("ignores malformed or unsafe stored serials", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-config-invalid-"));
    const configPath = join(root, "config.json");
    const store = new DeviceSelectionStore(configPath);
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(configPath, '{"schemaVersion":1,"selectedDevice":"bad --serial"}\n'),
    );

    assert.equal(store.getSelectedSerial(), undefined);
  });
});
