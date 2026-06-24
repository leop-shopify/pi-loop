import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import type { LoopScoreEntry } from "./state.ts";

export type TargetSource = "explicit" | "goal" | "history";
export type TargetFileKind = "source" | "test" | "docs" | "config" | "migration" | "script" | "generated";

export interface TargetContextSnapshot {
  schemaVersion: 1;
  id: string;
  createdAt: number;
  goal: { raw: string; normalized: string };
  files: Array<{ path: string; source: TargetSource; exists: boolean; kind?: TargetFileKind; sizeBytes?: number; mtimeMs?: number; sha256?: string }>;
  symbols: Array<{ name: string; source: TargetSource; file?: string }>;
  checks: Array<{ name: string; command: string; source: "explicit" | "package_script" | "inferred" | "history"; required: boolean }>;
  baseline: { cwd: string; git?: { branch?: string; head?: string; dirtyCount: number; dirtyFingerprint?: string }; packageManager?: "pnpm" | "npm" | "yarn" | "bun" | "unknown"; scripts?: string[] };
  history: { previousLoopCount: number; recentScores: Array<{ score: number; targetScore: number; timestamp: number; summary: string }>; bestPreviousScore?: { score: number; targetScore: number; timestamp: number; summary: string } };
}

export interface TargetContextOptions {
  cwd: string;
  goal: string;
  files?: string[];
  symbols?: string[];
  checks?: string[];
  priorScores?: LoopScoreEntry[];
  createdAt?: number;
}

export function buildTargetContextSnapshot(options: TargetContextOptions): TargetContextSnapshot {
  const createdAt = options.createdAt ?? Date.now();
  const packageManager = detectPackageManager(options.cwd);
  const scripts = packageScripts(options.cwd);
  const files = normalizeFiles(options.cwd, [...(options.files ?? []).map((file) => ({ path: file, source: "explicit" as const })), ...extractGoalFiles(options.goal).map((file) => ({ path: file, source: "goal" as const }))]);
  const recentScores = (options.priorScores ?? []).slice(-5).map((entry) => ({ score: entry.score, targetScore: entry.targetScore, timestamp: entry.timestamp, summary: entry.summary }));
  const bestPreviousScore = recentScores.length ? [...recentScores].sort((a, b) => b.score - a.score)[0] : undefined;
  const snapshot = {
    schemaVersion: 1 as const,
    id: "",
    createdAt,
    goal: { raw: options.goal, normalized: normalizeGoal(options.goal) },
    files,
    symbols: unique([...(options.symbols ?? []).map((name) => ({ name, source: "explicit" as const })), ...extractGoalSymbols(options.goal).map((name) => ({ name, source: "goal" as const }))], (item) => item.name),
    checks: normalizeChecks(options.checks ?? [], scripts, packageManager),
    baseline: { cwd: options.cwd, git: gitBaseline(options.cwd), packageManager, scripts },
    history: { previousLoopCount: options.priorScores?.length ?? 0, recentScores, bestPreviousScore },
  };
  return { ...snapshot, id: hashText(JSON.stringify({ goal: snapshot.goal.normalized, createdAt, files: snapshot.files.map((file) => file.path) })).slice(0, 16) };
}

export function formatTargetContext(snapshot: TargetContextSnapshot, maxChars = 2_000): string {
  const lines = [
    "Target context snapshot:",
    `- goal: ${snapshot.goal.raw}`,
    `- cwd: ${snapshot.baseline.cwd}`,
    `- package manager: ${snapshot.baseline.packageManager ?? "unknown"}`,
    `- scripts: ${snapshot.baseline.scripts?.length ? snapshot.baseline.scripts.join(", ") : "none detected"}`,
    `- git: ${snapshot.baseline.git?.branch ?? "unknown"}${snapshot.baseline.git?.head ? ` @ ${snapshot.baseline.git.head}` : ""}; dirty ${snapshot.baseline.git?.dirtyCount ?? 0}`,
    `- files: ${snapshot.files.length ? snapshot.files.map((file) => `${file.path}${file.exists ? "" : " (missing)"}`).join(", ") : "none normalized"}`,
    `- symbols: ${snapshot.symbols.length ? snapshot.symbols.map((symbol) => symbol.name).join(", ") : "none normalized"}`,
    `- checks: ${snapshot.checks.length ? snapshot.checks.map((check) => check.command).join("; ") : "none normalized"}`,
    `- previous scores: ${snapshot.history.recentScores.length ? snapshot.history.recentScores.map((score) => `${score.score}/${score.targetScore}`).join(", ") : "none"}`,
  ];
  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 12)}\n...truncated`;
}

function normalizeFiles(cwd: string, files: Array<{ path: string; source: TargetSource }>) {
  return unique(files.flatMap((file) => normalizeFile(cwd, file.path, file.source) ?? []), (file) => file.path).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeFile(cwd: string, raw: string, source: TargetSource) {
  const normalized = raw.replace(/^['"]|['"]$/g, "").replace(/^\.\//, "");
  const resolved = path.resolve(cwd, normalized);
  const root = path.resolve(cwd);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) return null;
  const exists = fs.existsSync(resolved);
  const stat = exists ? fs.statSync(resolved) : null;
  return { path: path.relative(cwd, resolved), source, exists, kind: classifyFile(normalized), sizeBytes: stat?.size, mtimeMs: stat?.mtimeMs, sha256: stat && stat.isFile() && stat.size <= 256_000 ? hashFile(resolved) : undefined };
}

function normalizeChecks(explicit: string[], scripts: string[], packageManager: TargetContextSnapshot["baseline"]["packageManager"]) {
  const runner = packageManager === "unknown" || packageManager === undefined ? "npm" : packageManager;
  const scriptChecks = scripts.filter((script) => /^(test|typecheck|check|lint)$/.test(script)).map((script) => ({ name: script, command: scriptCommand(runner, script), source: "package_script" as const, required: script === "test" || script === "check" }));
  return unique([...explicit.map((command) => ({ name: command, command, source: "explicit" as const, required: true })), ...scriptChecks], (check) => check.command);
}

function scriptCommand(runner: string, script: string): string {
  if (runner === "npm" && script !== "test") return `npm run ${script}`;
  return `${runner} ${script}`;
}

function detectPackageManager(cwd: string): TargetContextSnapshot["baseline"]["packageManager"] {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  return "unknown";
}

function packageScripts(cwd: string): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf-8")) as { scripts?: Record<string, unknown> };
    return Object.keys(parsed.scripts ?? {}).sort().slice(0, 50);
  } catch { return []; }
}

function gitBaseline(cwd: string) {
  const branch = git(cwd, ["branch", "--show-current"])[0];
  const head = git(cwd, ["rev-parse", "--short", "HEAD"])[0];
  const status = git(cwd, ["status", "--short"]);
  return { branch, head, dirtyCount: status.length, dirtyFingerprint: status.length ? hashText(status.join("\n")).slice(0, 16) : undefined };
}

function git(cwd: string, args: string[]): string[] {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", timeout: 1_000, maxBuffer: 64 * 1024 });
  if (result.status !== 0 || result.error) return [];
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function extractGoalFiles(goal: string): string[] {
  return goal.match(/[\w./-]+\.(?:ts|tsx|js|jsx|mjs|rb|md|json|yml|yaml|toml|css|scss)/g) ?? [];
}

function extractGoalSymbols(goal: string): string[] {
  return goal.match(/`([^`]+)`/g)?.map((match) => match.slice(1, -1)).filter((item) => !item.includes("/")) ?? [];
}

function classifyFile(filePath: string): TargetFileKind {
  if (/\.md$|^docs\//.test(filePath)) return "docs";
  if (/test|spec|\.test\.|\.spec\./.test(filePath)) return "test";
  if (/^db\/(migrate|post_migrate|data)/.test(filePath)) return "migration";
  if (/package\.json|tsconfig|\.ya?ml$|\.toml$/.test(filePath)) return "config";
  if (/^bin\/|^scripts\//.test(filePath)) return "script";
  if (/generated|dist\//.test(filePath)) return "generated";
  return "source";
}

function normalizeGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, " ").toLowerCase();
}

function hashFile(filePath: string): string {
  return hashText(fs.readFileSync(filePath));
}

function hashText(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const itemKey = key(item);
    if (seen.has(itemKey)) return false;
    seen.add(itemKey);
    return true;
  });
}
