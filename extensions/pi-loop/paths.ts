import * as fs from "node:fs";
import * as path from "node:path";

export const LOOP_DIR = ".loop";
export const LOOP_LOG_FILE = "log.jsonl";

export function loopDir(cwd: string): string {
  return path.join(cwd, LOOP_DIR);
}

export function loopLogPath(cwd: string): string {
  return path.join(loopDir(cwd), LOOP_LOG_FILE);
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function relativePath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return filePath;
  return relative;
}
