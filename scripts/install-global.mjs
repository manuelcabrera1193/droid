import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this installer through 'npm run install:global' so npm_execpath is available");

const packed = spawnSync(process.execPath, [npmCli, "pack", "--json"], { encoding: "utf8" });
if (packed.status !== 0) {
  process.stderr.write(packed.stderr || "npm pack failed\n");
  process.exit(packed.status ?? 1);
}

const result = JSON.parse(packed.stdout);
const filename = result[0]?.filename;
if (typeof filename !== "string" || filename.length === 0) {
  throw new Error("npm pack did not report a package filename");
}

const installed = spawnSync(process.execPath, [npmCli, "install", "--global", `./${filename}`], { stdio: "inherit" });
if (installed.status !== 0) process.exit(installed.status ?? 1);

process.stderr.write(
  `Installed a self-contained copy as 'local-android-mcp'. Moving this source folder will not break the global command. Package archive: ${filename}\n`,
);
