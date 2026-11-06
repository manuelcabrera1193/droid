import { AdbClient } from "./adb.js";
import type { AndroidDevice } from "./adb.js";
import { openLocalUrl, startDeviceUi } from "./ui.js";
import {
  buildServerLaunch,
  defaultDetectionContext,
  detectClients,
  installCliClient,
  installJsonClient,
  removeCliClient,
  removeJsonClient,
  type ClientId,
  type DetectedClient,
  type InstallResult,
} from "./installer.js";

const HELP = `local-android-mcp — portable Android MCP server and installer

Usage:
  local-android-mcp                         Start the MCP stdio server
  local-android-mcp serve                   Start the MCP stdio server
  local-android-mcp detect [--json]         Detect supported AI clients
  local-android-mcp doctor [--json]         Check ADB, device, and client readiness
  local-android-mcp ui [options]            Open the local device selector
  local-android-mcp install [options]       Configure every detected client
  local-android-mcp setup [options]         Alias for install
  local-android-mcp uninstall [options]     Remove only local-android entries

Install/uninstall options:
  --client <id[,id...]>  Limit the operation to specific clients
  --dry-run              Show the plan without writing anything
  --yes                  Apply the plan (required for changes)
  --force                Replace/remove a conflict; required for CLI-owned uninstall
  --json                 Print machine-readable output

UI options:
  --port <number>        Use a fixed localhost port (default: automatic)
  --no-open              Print the URL without opening a browser
  --json                 Print the URL as JSON

Supported client ids:
  vscode, copilot, cursor, claude-code, claude-desktop,
  codex, gemini, devin, windsurf-legacy
`;

interface ParsedOptions {
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  json: boolean;
  clientIds: ClientId[];
}

const CLIENT_IDS = new Set<ClientId>([
  "vscode",
  "copilot",
  "cursor",
  "claude-code",
  "claude-desktop",
  "codex",
  "gemini",
  "devin",
  "windsurf-legacy",
]);

function parseOptions(args: string[]): ParsedOptions {
  const result: ParsedOptions = { yes: false, dryRun: false, force: false, json: false, clientIds: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--yes" || argument === "-y") result.yes = true;
    else if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--force") result.force = true;
    else if (argument === "--json") result.json = true;
    else if (argument === "--all") continue;
    else if (argument === "--client") {
      const value = args[index + 1];
      if (!value) throw new Error("--client requires one or more comma-separated client ids");
      index += 1;
      for (const id of value.split(",")) {
        if (!CLIENT_IDS.has(id as ClientId)) throw new Error(`Unknown client id '${id}'`);
        result.clientIds.push(id as ClientId);
      }
    } else if (argument.startsWith("--client=")) {
      const value = argument.slice("--client=".length);
      for (const id of value.split(",")) {
        if (!CLIENT_IDS.has(id as ClientId)) throw new Error(`Unknown client id '${id}'`);
        result.clientIds.push(id as ClientId);
      }
    } else throw new Error(`Unknown option '${argument}'`);
  }
  if (result.yes && result.dryRun) throw new Error("Use either --yes or --dry-run, not both");
  return result;
}

function parseJsonOnly(args: string[], command: string): boolean {
  if (args.length === 0) return false;
  if (args.length === 1 && args[0] === "--json") return true;
  throw new Error(`${command} only accepts --json`);
}

function parseUiOptions(args: string[]): { port: number; open: boolean; json: boolean } {
  let port = 0;
  let open = true;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--no-open") open = false;
    else if (argument === "--json") json = true;
    else if (argument === "--port") {
      const value = args[index + 1];
      if (!value) throw new Error("--port requires a number from 0 to 65535");
      index += 1;
      port = Number(value);
    } else if (argument.startsWith("--port=")) port = Number(argument.slice("--port=".length));
    else throw new Error(`Unknown UI option '${argument}'`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port requires an integer from 0 to 65535");
  }
  return { port, open, json };
}

function selectedClients(clients: DetectedClient[], options: ParsedOptions): DetectedClient[] {
  if (options.clientIds.length > 0) {
    return options.clientIds.map((id) => {
      const client = clients.find((candidate) => candidate.id === id);
      if (!client?.detected) throw new Error(`Client '${id}' was not detected on this machine`);
      return client;
    });
  }
  const devinDetected = clients.some((client) => client.id === "devin" && client.detected);
  return clients.filter((client) => client.detected && !(client.id === "windsurf-legacy" && devinDetected));
}

function print(value: unknown, json: boolean): void {
  if (json) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else if (typeof value === "string") process.stdout.write(`${value}\n`);
  else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function operate(
  operation: "install" | "uninstall",
  options: ParsedOptions,
): Promise<number> {
  const context = defaultDetectionContext();
  const clients = selectedClients(detectClients(context), options);
  if (clients.length === 0) {
    print({ operation, changed: false, message: "No supported AI clients were detected" }, options.json);
    return 0;
  }
  const dryRun = options.dryRun || !options.yes;
  const resolvedServerCommand = context.resolveCommand("local-android-mcp");
  if (operation === "install" && !dryRun && !resolvedServerCommand) {
    throw new Error("The global command is not on PATH. Run 'npm run install:global' first, then retry.");
  }

  const launch = buildServerLaunch(context.platform, resolvedServerCommand);
  const results: Array<InstallResult | { clientId: ClientId; status: "failed"; message: string }> = [];
  for (const client of clients) {
    try {
      const result =
        operation === "install"
          ? client.strategy === "json"
            ? await installJsonClient(client, launch, { dryRun, force: options.force })
            : await installCliClient(client, launch, { dryRun, force: options.force })
          : client.strategy === "json"
            ? await removeJsonClient(client, launch, { dryRun, force: options.force })
            : await removeCliClient(client, { dryRun, force: options.force });
      results.push(result);
    } catch (error) {
      results.push({
        clientId: client.id,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const summary = {
    operation,
    mode: dryRun ? "plan" : "applied",
    results,
    ...(dryRun && !options.dryRun
      ? { next: `Review the plan and rerun with '${operation} --yes' to apply it.` }
      : {}),
  };
  if (options.json) print(summary, true);
  else {
    print(`${operation === "install" ? "Installation" : "Uninstallation"} ${dryRun ? "plan" : "result"}:`, false);
    for (const result of results) print(`- ${result.clientId}: ${result.status} — ${result.message}`, false);
    if (dryRun && !options.dryRun) print(`No files changed. Rerun with '${operation} --yes' to apply.`, false);
  }
  return results.some((result) => result.status === "failed") ? 1 : 0;
}

async function doctor(json: boolean): Promise<number> {
  const context = defaultDetectionContext();
  const clients = detectClients(context);
  const adb = new AdbClient();
  let adbStatus: Record<string, unknown>;
  try {
    const devices = await adb.listDevices();
    const authorizedDevices = devices.filter((device) => device.state === "device");
    adbStatus = {
      ok: authorizedDevices.length > 0,
      command: adb.adbCommand,
      devices,
      authorizedDeviceCount: authorizedDevices.length,
      ...(authorizedDevices.length === 0 ? { error: "No authorized Android device is ready" } : {}),
    };
  } catch (error) {
    adbStatus = { ok: false, command: adb.adbCommand, error: error instanceof Error ? error.message : String(error) };
  }
  const report = {
    serverCommand: context.resolveCommand("local-android-mcp") ?? null,
    adb: adbStatus,
    clients: clients.filter((client) => client.detected),
  };
  print(report, json);
  return doctorHealthy(
    report.serverCommand ?? undefined,
    (adbStatus.devices as AndroidDevice[] | undefined) ?? [],
    report.clients.length,
  ) ? 0 : 1;
}

export function doctorHealthy(
  serverCommand: string | undefined,
  devices: AndroidDevice[],
  configurableClientCount: number,
): boolean {
  return Boolean(serverCommand) && devices.some((device) => device.state === "device") && configurableClientCount > 0;
}

export async function runCli(args: string[]): Promise<number> {
  const command = args[0];
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "detect") {
    const json = parseJsonOnly(args.slice(1), "detect");
    const clients = detectClients(defaultDetectionContext());
    print(json ? clients : clients.map((client) => ({ id: client.id, name: client.name, detected: client.detected, reasons: client.detectionReasons })), json);
    return 0;
  }
  if (command === "doctor") {
    return await doctor(parseJsonOnly(args.slice(1), "doctor"));
  }
  if (command === "ui") {
    const options = parseUiOptions(args.slice(1));
    const ui = await startDeviceUi({ port: options.port });
    print(options.json ? { url: ui.url, host: "127.0.0.1" } : `Local Android UI: ${ui.url}\nPress Ctrl+C to stop.`, options.json);
    if (options.open) openLocalUrl(ui.url);
    return 0;
  }
  if (command === "install" || command === "setup") return await operate("install", parseOptions(args.slice(1)));
  if (command === "uninstall") return await operate("uninstall", parseOptions(args.slice(1)));
  throw new Error(`Unknown command '${command ?? ""}'. Run 'local-android-mcp help'.`);
}
