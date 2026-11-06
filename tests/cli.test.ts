import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doctorHealthy, runCli } from "../src/cli.js";

describe("CLI validation", () => {
  it("rejects flags that do not belong to read-only commands", async () => {
    await assert.rejects(runCli(["detect", "--yes"]), /only accepts --json/u);
    await assert.rejects(runCli(["doctor", "--dry-run"]), /only accepts --json/u);
    await assert.rejects(runCli(["ui", "--port", "not-a-port"]), /integer/u);
  });
});

describe("doctor readiness", () => {
  it("requires both the global command and an authorized device", () => {
    assert.equal(doctorHealthy("/bin/local-android-mcp", [{ serial: "one", state: "device" }], 1), true);
    assert.equal(doctorHealthy(undefined, [{ serial: "one", state: "device" }], 1), false);
    assert.equal(doctorHealthy("/bin/local-android-mcp", [{ serial: "one", state: "offline" }], 1), false);
    assert.equal(doctorHealthy("/bin/local-android-mcp", [], 1), false);
    assert.equal(doctorHealthy("/bin/local-android-mcp", [{ serial: "one", state: "device" }], 0), false);
  });
});
