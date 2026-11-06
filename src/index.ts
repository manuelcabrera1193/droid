#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runCli } from "./cli.js";
import { createServer } from "./server.js";

try {
  const args = process.argv.slice(2);
  if (args[0] === "serve" && args.length > 1) {
    throw new Error("serve does not accept arguments");
  }
  if (args.length === 0 || args[0] === "serve") {
    const server = createServer();
    await server.connect(new StdioServerTransport());
  } else {
    process.exitCode = await runCli(args);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`local-android-mcp: ${message}\n`);
  process.exitCode = 1;
}
