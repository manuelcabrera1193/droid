import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";

import { validateDeviceSerial } from "./adb.js";

type Environment = Record<string, string | undefined>;

interface UserConfig {
  schemaVersion: 1;
  selectedDevice?: string;
}

export function resolveUserConfigPath(
  platform: NodeJS.Platform = process.platform,
  homeDir = homedir(),
  environment: Environment = process.env,
): string {
  const explicit = environment.LOCAL_ANDROID_CONFIG_HOME?.trim();
  if (explicit) return platform === "win32" ? win32.join(explicit, "config.json") : join(explicit, "config.json");

  if (platform === "win32") {
    const root = environment.LOCALAPPDATA?.trim() || environment.APPDATA?.trim() || win32.join(homeDir, "AppData", "Local");
    return win32.join(root, "local-android-mcp", "config.json");
  }
  if (platform === "darwin") {
    return join(homeDir, "Library", "Application Support", "local-android-mcp", "config.json");
  }
  const root = environment.XDG_CONFIG_HOME?.trim() || join(homeDir, ".config");
  return join(root, "local-android-mcp", "config.json");
}

function parseConfig(source: string): UserConfig | undefined {
  try {
    const value = JSON.parse(source) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    if (candidate.schemaVersion !== 1) return undefined;
    if (candidate.selectedDevice === undefined) return { schemaVersion: 1 };
    if (typeof candidate.selectedDevice !== "string") return undefined;
    return { schemaVersion: 1, selectedDevice: validateDeviceSerial(candidate.selectedDevice) };
  } catch {
    return undefined;
  }
}

export class DeviceSelectionStore {
  constructor(readonly configPath = resolveUserConfigPath()) {}

  getSelectedSerial(): string | undefined {
    try {
      if (!existsSync(this.configPath) || lstatSync(this.configPath).isSymbolicLink()) return undefined;
      return parseConfig(readFileSync(this.configPath, "utf8"))?.selectedDevice;
    } catch {
      return undefined;
    }
  }

  async setSelectedSerial(serial: string | undefined): Promise<void> {
    const selectedDevice = serial?.trim() ? validateDeviceSerial(serial.trim()) : undefined;
    try {
      if ((await lstat(this.configPath)).isSymbolicLink()) {
        throw new Error(`Refusing to replace symbolic-link configuration: ${this.configPath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await mkdir(dirname(this.configPath), { recursive: true });
    const temporary = `${this.configPath}.tmp-${process.pid}-${randomUUID()}`;
    const config: UserConfig = selectedDevice
      ? { schemaVersion: 1, selectedDevice }
      : { schemaVersion: 1 };
    try {
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await chmod(temporary, 0o600).catch(() => undefined);
      await rename(temporary, this.configPath);
    } catch (error) {
      await import("node:fs/promises").then(({ unlink }) => unlink(temporary).catch(() => undefined));
      throw error;
    }
  }
}

export function getPersistedDeviceSerial(): string | undefined {
  return new DeviceSelectionStore().getSelectedSerial();
}
