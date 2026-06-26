import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const LOOP_DIR = "pi-loop";
export const LOOP_LOG_FILE = "log.jsonl";
const GLOBAL_LOOP_ROOT = path.join(os.homedir(), ".pi", "agent", LOOP_DIR, "projects");

export function loopDir(cwd: string): string {
  return path.join(GLOBAL_LOOP_ROOT, projectKey(cwd));
}

export function loopLogPath(cwd: string): string {
  return path.join(loopDir(cwd), LOOP_LOG_FILE);
}

function projectKey(cwd: string): string {
  const resolved = path.resolve(cwd);
  const slug = path.basename(resolved).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48) || "project";
  const hash = crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  return `${slug}-${hash}`;
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function relativePath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return filePath;
  return relative;
}
