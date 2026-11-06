import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const installedCommand = process.env.LOCAL_ANDROID_MCP_COMMAND;
const npmCli = process.env.npm_execpath;
if (!installedCommand && !npmCli) {
  throw new Error(
    "Run this smoke through 'npm run smoke' or set LOCAL_ANDROID_MCP_COMMAND to an installed executable",
  );
}

const transport = new StdioClientTransport({
  command: installedCommand ?? process.execPath,
  args: installedCommand ? [] : [npmCli, "run", "--silent", "mcp"],
  stderr: "pipe",
});
const client = new Client({ name: "local-android-smoke", version: "0.1.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  assert.ok(names.includes("android_list_devices"));
  assert.ok(names.includes("android_screenshot"));

  const result = await client.callTool({ name: "android_list_devices", arguments: {} });
  assert.equal(result.isError, undefined);
  process.stderr.write(`MCP smoke passed: ${names.length} tools; ADB device listing succeeded.\n`);
} finally {
  await client.close();
}
