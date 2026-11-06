import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EmulatorManager,
  parseAvdList,
  resolveEmulatorCommand,
  type DetachedLauncher,
} from "../src/emulator.js";
import type { CommandInvocation, CommandRunner } from "../src/adb.js";

class FakeRunner implements CommandRunner {
  readonly calls: CommandInvocation[] = [];

  async run(invocation: CommandInvocation): Promise<Buffer> {
    this.calls.push(invocation);
    return Buffer.from("Pixel_8_API_35\nSmall_Phone\n");
  }
}

describe("Android emulator management", () => {
  it("resolves the emulator from the SDK without a machine-specific path", () => {
    assert.equal(
      resolveEmulatorCommand(
        { ANDROID_SDK_ROOT: "/portable/sdk" },
        "linux",
        (candidate) => candidate === "/portable/sdk/emulator/emulator",
      ),
      "/portable/sdk/emulator/emulator",
    );
  });

  it("parses only safe AVD identifiers", () => {
    assert.deepEqual(parseAvdList("Pixel_8_API_35\ninvalid avd\nSmall.Phone\n"), [
      "Pixel_8_API_35",
      "Small.Phone",
    ]);
  });

  it("starts only an AVD returned by the emulator inventory", async () => {
    const runner = new FakeRunner();
    const launches: Array<{ command: string; args: string[] }> = [];
    const launcher: DetachedLauncher = async (command, args) => {
      launches.push({ command, args });
    };
    const manager = new EmulatorManager({ emulatorCommand: "emulator", runner, launcher });

    await manager.startAvd("Pixel_8_API_35");
    assert.deepEqual(launches, [{ command: "emulator", args: ["-avd", "Pixel_8_API_35"] }]);
    await assert.rejects(manager.startAvd("Unknown_AVD"), /not available/u);
  });

  it("reports a launcher spawn failure", async () => {
    const manager = new EmulatorManager({
      emulatorCommand: "emulator",
      runner: new FakeRunner(),
      launcher: async () => {
        throw new Error("spawn denied");
      },
    });

    await assert.rejects(manager.startAvd("Pixel_8_API_35"), /spawn denied/u);
  });
});
