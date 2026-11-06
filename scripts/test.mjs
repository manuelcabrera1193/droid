import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const testsDirectory = fileURLToPath(new URL("../dist/tests/", import.meta.url));
const tests = readdirSync(testsDirectory)
  .filter((filename) => filename.endsWith(".test.js"))
  .sort()
  .map((filename) => fileURLToPath(new URL(`../dist/tests/${filename}`, import.meta.url)));

if (tests.length === 0) throw new Error("No compiled test files found");

const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(result.status ?? 1);
