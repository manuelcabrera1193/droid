import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AdbClient, type CommandInvocation, type CommandRunner } from "../src/adb.js";

class FakeRunner implements CommandRunner {
  readonly calls: CommandInvocation[] = [];

  async run(invocation: CommandInvocation): Promise<Buffer> {
    this.calls.push(invocation);
    if (invocation.args.join(" ") === "devices -l") {
      return Buffer.from("List of devices attached\nserial-1 device model:Pixel transport_id:1\n");
    }
    return Buffer.from("ok");
  }
}

describe("AdbClient", () => {
  it("inserts the selected serial before device commands", async () => {
    const runner = new FakeRunner();
    const client = new AdbClient({ adbCommand: "adb", runner });

    await client.tap({ x: 10, y: 20 });

    assert.deepEqual(runner.calls, [
      { command: "adb", args: ["devices", "-l"], timeoutMs: 10_000, maxBytes: 1_000_000 },
      {
        command: "adb",
        args: ["-s", "serial-1", "shell", "input", "tap", "10", "20"],
        timeoutMs: 10_000,
        maxBytes: 1_000_000,
      },
    ]);
  });

  it("honors an explicit serial and never interpolates it into a shell command", async () => {
    const runner = new FakeRunner();
    const client = new AdbClient({ adbCommand: "adb", runner, defaultSerial: "serial-2" });

    await client.pressKey("BACK");

    assert.deepEqual(runner.calls[0]?.args, [
      "-s",
      "serial-2",
      "shell",
      "input",
      "keyevent",
      "KEYCODE_BACK",
    ]);
  });

  it("reads a persisted selection dynamically when no explicit serial is set", async () => {
    const runner = new FakeRunner();
    let selected = "serial-2";
    const client = new AdbClient({
      adbCommand: "adb",
      runner,
      defaultSerialProvider: () => selected,
    });

    await client.pressKey("HOME");
    selected = "serial-3";
    await client.pressKey("BACK");

    assert.equal(runner.calls[0]?.args[1], "serial-2");
    assert.equal(runner.calls[1]?.args[1], "serial-3");
  });
});
