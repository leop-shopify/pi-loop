import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const piBin = process.env.PI_BIN ?? findPiBinary();

if (!piBin) {
  console.error("Could not find a Pi binary outside local node_modules/.bin. Set PI_BIN=/path/to/pi and retry.");
  process.exit(1);
}

for (const prompt of ["/loop status", "/goal status"]) {
  const result = spawnSync(piBin, [
    "--mode",
    "json",
    "--no-session",
    "--no-extensions",
    "-e",
    "./extensions/pi-loop/index.ts",
    "-p",
    prompt,
  ], { stdio: "inherit" });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findPiBinary() {
  const paths = (process.env.PATH ?? "").split(delimiter);
  for (const directory of paths) {
    if (!directory || directory.includes("node_modules/.bin") || directory.includes("/.local/share/pnpm")) continue;
    const candidate = join(directory, "pi");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
