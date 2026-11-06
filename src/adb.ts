import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export interface AndroidDevice {
  serial: string;
  state: string;
  product?: string;
  model?: string;
  device?: string;
  transportId?: number;
}

export interface CommandInvocation {
  command: string;
  args: string[];
  timeoutMs: number;
  maxBytes: number;
}

export interface CommandRunner {
  run(invocation: CommandInvocation): Promise<Buffer>;
}

export class CommandExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandExecutionError";
  }
}

export class SpawnCommandRunner implements CommandRunner {
  async run({ command, args, timeoutMs, maxBytes }: CommandInvocation): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let totalBytes = 0;
      let settled = false;

      const finish = (error?: Error, output?: Buffer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(output ?? Buffer.alloc(0));
      };

      const collect = (target: Buffer[], chunk: Buffer): void => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          child.kill("SIGKILL");
          finish(new CommandExecutionError(`ADB output exceeded the ${maxBytes}-byte safety limit`));
          return;
        }
        target.push(chunk);
      };

      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.on("error", (error) => {
        finish(
          new CommandExecutionError(
            error.message.includes("ENOENT")
              ? `ADB executable not found (${command}). Install Android platform-tools or set ANDROID_ADB_PATH.`
              : `Unable to start ADB: ${error.message}`,
          ),
        );
      });
      child.on("close", (code, signal) => {
        if (settled) return;
        const errorText = Buffer.concat(stderr).toString("utf8").trim();
        if (code !== 0) {
          finish(
            new CommandExecutionError(
              `ADB failed${code === null ? ` (${signal ?? "terminated"})` : ` with exit code ${code}`}${
                errorText ? `: ${errorText.slice(0, 2_000)}` : ""
              }`,
            ),
          );
          return;
        }
        finish(undefined, Buffer.concat(stdout));
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new CommandExecutionError(`ADB timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      timer.unref();
    });
  }
}

type Environment = Record<string, string | undefined>;
type Exists = (candidate: string) => boolean;

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveAdbCommand(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: Exists = isExecutable,
): string {
  const explicit = environment.ANDROID_ADB_PATH?.trim() || environment.ADB_PATH?.trim();
  if (explicit) return explicit;

  const executable = platform === "win32" ? "adb.exe" : "adb";
  for (const root of [environment.ANDROID_SDK_ROOT, environment.ANDROID_HOME]) {
    if (!root?.trim()) continue;
    const candidate = join(root, "platform-tools", executable);
    if (exists(candidate)) return candidate;
  }

  if (environment.PATH) {
    for (const entry of environment.PATH.split(delimiter)) {
      if (!entry) continue;
      const candidate = join(entry, executable);
      if (exists(candidate)) return candidate;
    }
  }

  return "adb";
}

export function parseAdbDevices(output: string): AndroidDevice[] {
  const devices: AndroidDevice[] = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("List of devices attached") || line.startsWith("* daemon")) continue;
    const fields = line.split(/\s+/u);
    const serial = fields[0];
    const state = fields[1];
    if (!serial || !state) continue;

    const device: AndroidDevice = { serial, state };
    for (const field of fields.slice(2)) {
      const separator = field.indexOf(":");
      if (separator < 1) continue;
      const key = field.slice(0, separator);
      const value = field.slice(separator + 1);
      if (key === "product") device.product = value;
      else if (key === "model") device.model = value;
      else if (key === "device") device.device = value;
      else if (key === "transport_id" && /^\d+$/u.test(value)) device.transportId = Number(value);
    }
    devices.push(device);
  }
  return devices;
}

export function selectDeviceSerial(devices: AndroidDevice[], requested?: string): string {
  const normalized = requested?.trim();
  if (normalized) {
    const match = devices.find((device) => device.serial === normalized);
    if (!match) throw new Error(`Android device '${normalized}' is not attached`);
    if (match.state !== "device") throw new Error(`Android device '${normalized}' is ${match.state}, not authorized`);
    return match.serial;
  }

  const ready = devices.filter((device) => device.state === "device");
  if (ready.length === 0) {
    throw new Error("No authorized Android device found. Connect a device and accept the USB debugging prompt.");
  }
  if (ready.length > 1) {
    throw new Error(
      `Multiple authorized Android devices found (${ready.map((item) => item.serial).join(", ")}). Pass device or set ANDROID_SERIAL.`,
    );
  }
  return ready[0]!.serial;
}

const SAFE_TEXT = /^[A-Za-z0-9 @._+\-/:,]*$/u;
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u;
const DEVICE_SERIAL = /^[A-Za-z0-9._:-]{1,256}$/u;

export function validateDeviceSerial(value: string): string {
  if (!DEVICE_SERIAL.test(value)) throw new Error("Invalid ADB device serial");
  return value;
}

export function encodeInputText(value: string): string {
  if (value.length === 0 || value.length > 2_000 || !SAFE_TEXT.test(value)) {
    throw new Error(
      "Text contains unsupported characters. Allowed: letters, digits, spaces, and @ . _ + - / : , (maximum 2000 characters).",
    );
  }
  return value.replaceAll(" ", "%s");
}

export function validatePackageName(value: string): string {
  if (!PACKAGE_NAME.test(value)) throw new Error("Invalid Android package name");
  return value;
}

export const SAFE_KEYS = [
  "BACK",
  "HOME",
  "ENTER",
  "TAB",
  "ESCAPE",
  "APP_SWITCH",
  "DPAD_UP",
  "DPAD_DOWN",
  "DPAD_LEFT",
  "DPAD_RIGHT",
  "DPAD_CENTER",
  "VOLUME_UP",
  "VOLUME_DOWN",
] as const;

export type SafeKey = (typeof SAFE_KEYS)[number];

export interface AdbClientOptions {
  adbCommand?: string;
  defaultSerial?: string;
  defaultSerialProvider?: () => string | undefined;
  runner?: CommandRunner;
}

interface DeviceSelection {
  device?: string | undefined;
}

export class AdbClient {
  readonly adbCommand: string;
  readonly defaultSerial: string | undefined;
  readonly runner: CommandRunner;
  private readonly defaultSerialProvider: (() => string | undefined) | undefined;

  constructor(options: AdbClientOptions = {}) {
    this.adbCommand = options.adbCommand ?? resolveAdbCommand();
    const serial = options.defaultSerial?.trim() || process.env.ANDROID_SERIAL?.trim();
    this.defaultSerial = serial || undefined;
    this.defaultSerialProvider = options.defaultSerialProvider;
    this.runner = options.runner ?? new SpawnCommandRunner();
  }

  private async run(args: string[], timeoutMs = 10_000, maxBytes = 1_000_000): Promise<Buffer> {
    return await this.runner.run({ command: this.adbCommand, args, timeoutMs, maxBytes });
  }

  async listDevices(): Promise<AndroidDevice[]> {
    return parseAdbDevices((await this.run(["devices", "-l"])).toString("utf8"));
  }

  async resolveSerial(requested?: string): Promise<string> {
    const explicit = requested?.trim() || this.defaultSerial || this.defaultSerialProvider?.()?.trim();
    if (explicit) return validateDeviceSerial(explicit);
    return selectDeviceSerial(await this.listDevices());
  }

  private async runDevice(
    args: string[],
    options: DeviceSelection & { timeoutMs?: number; maxBytes?: number } = {},
  ): Promise<Buffer> {
    const serial = await this.resolveSerial(options.device);
    return await this.run(
      ["-s", serial, ...args],
      options.timeoutMs ?? 10_000,
      options.maxBytes ?? 1_000_000,
    );
  }

  async tap(input: { x: number; y: number } & DeviceSelection): Promise<void> {
    await this.runDevice(["shell", "input", "tap", String(input.x), String(input.y)], input);
  }

  async swipe(input: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    durationMs: number;
  } & DeviceSelection): Promise<void> {
    await this.runDevice(
      [
        "shell",
        "input",
        "swipe",
        String(input.x1),
        String(input.y1),
        String(input.x2),
        String(input.y2),
        String(input.durationMs),
      ],
      input,
    );
  }

  async typeText(input: { text: string } & DeviceSelection): Promise<void> {
    await this.runDevice(["shell", "input", "text", encodeInputText(input.text)], input);
  }

  async pressKey(key: SafeKey, device?: string): Promise<void> {
    await this.runDevice(["shell", "input", "keyevent", `KEYCODE_${key}`], { device });
  }

  async screenshot(device?: string): Promise<Buffer> {
    return await this.runDevice(["exec-out", "screencap", "-p"], {
      device,
      timeoutMs: 20_000,
      maxBytes: 25_000_000,
    });
  }

  async getUiTree(device?: string): Promise<string> {
    const output = (
      await this.runDevice(["exec-out", "uiautomator", "dump", "/dev/tty"], {
        device,
        timeoutMs: 20_000,
        maxBytes: 5_000_000,
      })
    ).toString("utf8");
    const start = output.indexOf("<?xml");
    if (start === -1) throw new Error(`UIAutomator did not return XML: ${output.trim().slice(0, 500)}`);
    return output.slice(start).trim();
  }

  async getDeviceInfo(device?: string): Promise<Record<string, string>> {
    const output = (
      await this.runDevice(["shell", "getprop"], { device, timeoutMs: 10_000, maxBytes: 2_000_000 })
    ).toString("utf8");
    const wanted = new Set([
      "ro.build.version.release",
      "ro.build.version.sdk",
      "ro.build.version.security_patch",
      "ro.product.brand",
      "ro.product.manufacturer",
      "ro.product.model",
      "ro.product.cpu.abilist",
    ]);
    const result: Record<string, string> = {};
    for (const line of output.split(/\r?\n/u)) {
      const match = line.match(/^\[([^\]]+)\]: \[(.*)\]$/u);
      if (match?.[1] && wanted.has(match[1])) result[match[1]] = match[2] ?? "";
    }
    return result;
  }

  async listPackages(input: { thirdPartyOnly: boolean } & DeviceSelection): Promise<string[]> {
    const args = ["shell", "pm", "list", "packages"];
    if (input.thirdPartyOnly) args.push("-3");
    const output = (await this.runDevice(args, input)).toString("utf8");
    return output
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^package:/u, ""))
      .filter((line) => PACKAGE_NAME.test(line))
      .sort();
  }

  async launchApp(input: { packageName: string } & DeviceSelection): Promise<string> {
    const packageName = validatePackageName(input.packageName);
    return (
      await this.runDevice(
        ["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"],
        input,
      )
    )
      .toString("utf8")
      .trim();
  }

  async forceStopApp(input: { packageName: string } & DeviceSelection): Promise<void> {
    await this.runDevice(["shell", "am", "force-stop", validatePackageName(input.packageName)], input);
  }
}
