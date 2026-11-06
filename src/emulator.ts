import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

import type { CommandInvocation, CommandRunner } from "./adb.js";

type Environment = Record<string, string | undefined>;
type Exists = (candidate: string) => boolean;

const AVD_NAME = /^[A-Za-z0-9._-]{1,128}$/u;

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveEmulatorCommand(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: Exists = isExecutable,
): string {
  const explicit = environment.ANDROID_EMULATOR_PATH?.trim() || environment.EMULATOR_PATH?.trim();
  if (explicit) return explicit;
  const executable = platform === "win32" ? "emulator.exe" : "emulator";
  for (const root of [environment.ANDROID_SDK_ROOT, environment.ANDROID_HOME]) {
    if (!root?.trim()) continue;
    const candidate = join(root, "emulator", executable);
    if (exists(candidate)) return candidate;
  }
  for (const entry of environment.PATH?.split(delimiter) ?? []) {
    if (!entry) continue;
    const candidate = join(entry, executable);
    if (exists(candidate)) return candidate;
  }
  return executable;
}

export function parseAvdList(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => AVD_NAME.test(line));
}

class EmulatorCommandRunner implements CommandRunner {
  async run(invocation: CommandInvocation): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(Buffer.concat(stdout));
      };
      const collect = (target: Buffer[], chunk: Buffer): void => {
        bytes += chunk.length;
        if (bytes > invocation.maxBytes) {
          child.kill("SIGKILL");
          finish(new Error("Android emulator output exceeded the safety limit"));
        } else target.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.on("error", (error) => finish(new Error(`Unable to start Android emulator command: ${error.message}`)));
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0) finish(new Error(`Android emulator command failed: ${Buffer.concat(stderr).toString("utf8").trim().slice(0, 1000)}`));
        else finish();
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("Android emulator command timed out"));
      }, invocation.timeoutMs);
      timer.unref();
    });
  }
}

export type DetachedLauncher = (command: string, args: string[]) => Promise<void>;

async function launchDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: false,
    });
    child.once("error", (error) => reject(new Error(`Unable to launch Android emulator: ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

interface EmulatorManagerOptions {
  emulatorCommand?: string;
  runner?: CommandRunner;
  launcher?: DetachedLauncher;
}

export class EmulatorManager {
  readonly command: string;
  private readonly runner: CommandRunner;
  private readonly launcher: DetachedLauncher;

  constructor(options: EmulatorManagerOptions = {}) {
    this.command = options.emulatorCommand ?? resolveEmulatorCommand();
    this.runner = options.runner ?? new EmulatorCommandRunner();
    this.launcher = options.launcher ?? launchDetached;
  }

  async listAvds(): Promise<string[]> {
    const output = await this.runner.run({
      command: this.command,
      args: ["-list-avds"],
      timeoutMs: 10_000,
      maxBytes: 256_000,
    });
    return parseAvdList(output.toString("utf8"));
  }

  async startAvd(name: string): Promise<void> {
    if (!AVD_NAME.test(name)) throw new Error("Invalid Android Virtual Device name");
    const avds = await this.listAvds();
    if (!avds.includes(name)) throw new Error(`Android Virtual Device '${name}' is not available`);
    await this.launcher(this.command, ["-avd", name]);
  }
}
