import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildServerLaunch,
  buildCliInstallInvocation,
  detectClients,
  installJsonClient,
  installCliClient,
  mergeMcpJson,
  prepareExternalInvocation,
  removeJsonClient,
  removeMcpJson,
  resolveCommandOnPath,
  type DetectionContext,
} from "../src/installer.js";

function context(overrides: Partial<DetectionContext> = {}): DetectionContext {
  const commands = new Set(["code", "codex", "claude", "gemini"]);
  const paths = new Set<string>();
  return {
    platform: "darwin",
    homeDir: "/portable/home",
    environment: {},
    resolveCommand: (command) => (commands.has(command) ? command : undefined),
    pathExists: (path) => paths.has(path),
    ...overrides,
  };
}

describe("portable MCP launch configuration", () => {
  it("uses the globally installed command rather than a repository path", () => {
    assert.deepEqual(buildServerLaunch("darwin"), {
      command: "local-android-mcp",
      args: [],
    });
  });

  it("uses the Windows command shim portably", () => {
    assert.deepEqual(buildServerLaunch("win32", "C:\\Users\\portable\\bin\\local-android-mcp.cmd"), {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "call", "C:\\Users\\portable\\bin\\local-android-mcp.cmd"],
    });
  });
});

describe("AI client detection", () => {
  it("detects command-backed clients and calculates per-user paths dynamically", () => {
    const clients = detectClients(context());
    const byId = new Map(clients.map((client) => [client.id, client]));

    assert.equal(byId.get("vscode")?.detected, true);
    assert.equal(byId.get("codex")?.detected, true);
    assert.equal(byId.get("claude-code")?.detected, true);
    assert.equal(byId.get("gemini")?.detected, true);
    assert.equal(byId.get("cursor")?.detected, false);
    assert.equal(
      byId.get("vscode")?.configPath,
      "/portable/home/Library/Application Support/Code/User/mcp.json",
    );
    assert.equal(byId.get("gemini")?.configPath, "/portable/home/.gemini/settings.json");
  });

  it("does not treat a residual CLI directory as a configurable client", () => {
    const clients = detectClients(
      context({
        resolveCommand: () => undefined,
        pathExists: (path) => path === "/portable/home/.codex",
      }),
    );
    const codex = clients.find((client) => client.id === "codex")!;
    assert.equal(codex.detected, false);
    assert.ok(codex.detectionReasons.some((reason) => reason.includes(".codex")));
  });

  it("honors XDG and COPILOT_HOME without embedding a machine path", () => {
    const clients = detectClients(
      context({
        platform: "linux",
        environment: {
          XDG_CONFIG_HOME: "/portable/config",
          COPILOT_HOME: "/portable/copilot",
        },
        resolveCommand: (command) => (command === "copilot" ? command : undefined),
      }),
    );
    const byId = new Map(clients.map((client) => [client.id, client]));

    assert.equal(byId.get("copilot")?.configPath, "/portable/copilot/mcp-config.json");
    assert.equal(byId.get("claude-desktop")?.configPath, "/portable/config/Claude/claude_desktop_config.json");
    assert.equal(byId.get("vscode")?.configPath, "/portable/config/Code/User/mcp.json");
  });

  it("honors CODEX_HOME and CLAUDE_CONFIG_DIR for provider-owned configuration", () => {
    const clients = detectClients(
      context({
        platform: "linux",
        environment: {
          CODEX_HOME: "/portable/codex",
          CLAUDE_CONFIG_DIR: "/portable/claude",
        },
      }),
    );
    const byId = new Map(clients.map((client) => [client.id, client]));

    assert.equal(byId.get("codex")?.configPath, "/portable/codex/config.toml");
    assert.equal(byId.get("claude-code")?.configPath, "/portable/claude/.claude.json");
  });
});

describe("provider-owned CLI configuration", () => {
  it("builds fixed argument arrays without a shell", () => {
    const codex = detectClients(context()).find((client) => client.id === "codex")!;
    assert.deepEqual(buildCliInstallInvocation(codex, buildServerLaunch("darwin")), {
      command: "codex",
      args: ["mcp", "add", "local-android", "--", "local-android-mcp"],
    });
  });

  it("requires force before a provider CLI may replace an entry", async () => {
    const codex = detectClients(context()).find((client) => client.id === "codex")!;
    let invoked = false;
    await assert.rejects(
      installCliClient(codex, buildServerLaunch("darwin"), {
        runner: async () => {
          invoked = true;
        },
      }),
      /--force/u,
    );
    assert.equal(invoked, false);
  });

  it("passes the Windows shim as separate arguments", () => {
    const claude = {
      ...detectClients(context()).find((client) => client.id === "claude-code")!,
      cliCommand: "C:\\Program Files\\nodejs\\claude.cmd",
    };
    const invocation = buildCliInstallInvocation(
      claude,
      buildServerLaunch("win32", "C:\\Program Files\\nodejs\\local-android-mcp.cmd"),
    );
    assert.deepEqual(prepareExternalInvocation(invocation, "win32", "C:\\Windows\\System32\\cmd.exe"), {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        'call "C:\\Program Files\\nodejs\\claude.cmd" mcp add --scope user local-android -- C:\\Windows\\System32\\cmd.exe /d /s /c call "C:\\Program Files\\nodejs\\local-android-mcp.cmd"',
      ],
    });
  });
});

describe("safe JSON configuration merge", () => {
  const launch = { command: "/runtime/node", args: ["/pkg/index.js", "serve"] };

  it("preserves unrelated settings and servers", () => {
    const source = JSON.stringify({ theme: "dark", mcpServers: { existing: { command: "other" } } });
    const merged = JSON.parse(mergeMcpJson(source, "mcpServers", launch));

    assert.equal(merged.theme, "dark");
    assert.deepEqual(merged.mcpServers.existing, { command: "other" });
    assert.deepEqual(merged.mcpServers["local-android"], launch);
  });

  it("supports VS Code's servers key and keeps JSON comments", () => {
    const source = `{
  // user preference
  "servers": { "existing": { "type": "stdio", "command": "other" } }
}\n`;
    const merged = mergeMcpJson(source, "servers", launch, { type: "stdio" });

    assert.match(merged, /\/\/ user preference/u);
    assert.match(merged, /"local-android"/u);
    assert.match(merged, /"type": "stdio"/u);
  });

  it("removes only this server", () => {
    const source = JSON.stringify({ mcpServers: { existing: { command: "other" }, "local-android": launch } });
    const removed = JSON.parse(removeMcpJson(source, "mcpServers"));

    assert.deepEqual(removed, { mcpServers: { existing: { command: "other" } } });
  });

  it("treats reordered properties as the same owned configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-order-"));
    const configPath = join(root, "mcp.json");
    await writeFile(
      configPath,
      '{"mcpServers":{"local-android":{"args":[],"command":"local-android-mcp"}}}\n',
    );
    const client = {
      id: "cursor" as const,
      name: "Cursor",
      detected: true,
      detectionReasons: ["test"],
      strategy: "json" as const,
      configPath,
      topLevelKey: "mcpServers" as const,
    };
    const install = await installJsonClient(client, { command: "local-android-mcp", args: [] });
    const removal = await removeJsonClient(client, { command: "local-android-mcp", args: [] });
    assert.equal(install.status, "unchanged");
    assert.equal(removal.status, "removed");
  });

  it("rejects malformed configuration instead of overwriting it", () => {
    assert.throws(() => mergeMcpJson("{broken", "mcpServers", launch), /invalid JSON/u);
  });

  it("rejects duplicate keys that could shadow an edited server", () => {
    assert.throws(
      () => mergeMcpJson('{"mcpServers":{},"mcpServers":{}}', "mcpServers", launch),
      /duplicate key/u,
    );
    assert.throws(
      () =>
        mergeMcpJson(
          '{"mcpServers":{"local-android":{},"local-android":{"command":"shadow"}}}',
          "mcpServers",
          launch,
        ),
      /duplicate key/u,
    );
  });
});

describe("JSON client installation", () => {
  it("creates a sibling backup and atomically preserves unrelated configuration", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-installer-"));
    const configPath = join(root, "client", "mcp.json");
    await mkdir(join(root, "client"), { recursive: true });
    await writeFile(configPath, '{"mcpServers":{"existing":{"command":"other"}}}\n');

    const result = await installJsonClient(
      {
        id: "cursor",
        name: "Cursor",
        detected: true,
        detectionReasons: ["test"],
        strategy: "json",
        configPath,
        topLevelKey: "mcpServers",
      },
      { command: "local-android-mcp", args: [] },
      { timestamp: "20261027T120000Z" },
    );

    assert.equal(result.status, "installed");
    assert.equal(result.backupPath, `${configPath}.backup-20261027T120000Z`);
    assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
      mcpServers: {
        existing: { command: "other" },
        "local-android": { command: "local-android-mcp", args: [] },
      },
    });
    assert.match(await readFile(result.backupPath!, "utf8"), /existing/u);
  });

  it("refuses to replace a different existing entry unless force is explicit", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-conflict-"));
    const configPath = join(root, "mcp.json");
    await writeFile(configPath, '{"mcpServers":{"local-android":{"command":"different"}}}\n');
    const client = {
      id: "cursor" as const,
      name: "Cursor",
      detected: true,
      detectionReasons: ["test"],
      strategy: "json" as const,
      configPath,
      topLevelKey: "mcpServers" as const,
    };

    await assert.rejects(
      installJsonClient(client, { command: "local-android-mcp", args: [] }),
      /--force/u,
    );
  });

  it("does not remove a same-named entry it did not create", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-uninstall-"));
    const configPath = join(root, "mcp.json");
    await writeFile(configPath, '{"mcpServers":{"local-android":{"command":"different"}}}\n');
    const client = {
      id: "cursor" as const,
      name: "Cursor",
      detected: true,
      detectionReasons: ["test"],
      strategy: "json" as const,
      configPath,
      topLevelKey: "mcpServers" as const,
    };

    await assert.rejects(
      removeJsonClient(client, { command: "local-android-mcp", args: [] }),
      /not owned/u,
    );
    assert.match(await readFile(configPath, "utf8"), /different/u);
  });

  it("never overwrites an earlier backup with the same timestamp", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-backup-"));
    const configPath = join(root, "mcp.json");
    await writeFile(configPath, '{"mcpServers":{"local-android":{"command":"original"}}}\n');
    const client = {
      id: "cursor" as const,
      name: "Cursor",
      detected: true,
      detectionReasons: ["test"],
      strategy: "json" as const,
      configPath,
      topLevelKey: "mcpServers" as const,
    };
    const first = await installJsonClient(
      client,
      { command: "first", args: [] },
      { force: true, timestamp: "same" },
    );
    const second = await installJsonClient(
      client,
      { command: "second", args: [] },
      { force: true, timestamp: "same" },
    );

    assert.notEqual(first.backupPath, second.backupPath);
    assert.match(await readFile(first.backupPath!, "utf8"), /original/u);
    assert.match(await readFile(second.backupPath!, "utf8"), /first/u);
  });
});

describe("executable discovery", () => {
  it("rejects non-executable files and directories on POSIX", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-android-path-"));
    const candidate = join(root, "tool");
    await writeFile(candidate, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
    await mkdir(join(root, "directory-tool"));

    assert.equal(resolveCommandOnPath("tool", root, "linux"), undefined);
    assert.equal(resolveCommandOnPath("directory-tool", root, "linux"), undefined);
    await chmod(candidate, 0o755);
    assert.equal(resolveCommandOnPath("tool", root, "linux"), candidate);
  });
});
