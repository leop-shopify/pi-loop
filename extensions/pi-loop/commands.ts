import { DEFAULT_MINUTES, DEFAULT_RUNS, DEFAULT_TARGET, DEFAULT_TURNS, MAX_RUNS } from "./constants.ts";
import { loopLogPath } from "./paths.ts";
import { bestScore, type LoopRuntimeState } from "./state.ts";

export interface ParsedLoopArgs {
  command: "start" | "status" | "off" | "clear" | "help";
  goal: string;
  minutes: number;
  turns: number;
  target: number;
  runs: number;
  files: string[];
  symbols: string[];
  checks: string[];
}

export function parseLoopArgs(args: string): ParsedLoopArgs {
  const trimmed = args.trim();
  if (!trimmed) return defaultArgs("help");
  const lower = trimmed.toLowerCase();
  if (lower === "status") return defaultArgs("status");
  if (lower === "off" || lower === "stop") return defaultArgs("off");
  if (lower === "clear") return defaultArgs("clear");
  if (lower === "help") return defaultArgs("help");

  const parsed = parseStartArgs(tokenizeArgs(trimmed));
  return { command: parsed.goalTokens.length > 0 ? "start" : "help", goal: parsed.goalTokens.join(" "), minutes: parsed.minutes, turns: parsed.turns, target: parsed.target, runs: parsed.runs, files: parsed.files, symbols: parsed.symbols, checks: parsed.checks };
}

export function loopHelp(): string {
  return [
    "Usage: /loop <goal> [--minutes=60] [--turns=20] [--target=90] [--runs=1]",
    "       /loop <goal> [--file=path] [--symbol=Name] [--check=\"pnpm test\"]",
    "       /loop status",
    "       /loop off",
    "       /loop clear",
    "",
    "The loop restarts the agent while score_loop_result reports a score below the target and limits remain.",
  ].join("\n");
}

export function statusText(state: LoopRuntimeState, cwd: string): string {
  const last = state.results[state.results.length - 1];
  const best = bestScore(state);
  return [
    `Active: ${state.active ? "yes" : "no"}`,
    `Goal: ${state.goal ?? "none"}`,
    `Run: ${state.currentRun}/${state.maxRuns}`,
    `Turns: ${state.turnsStarted}/${state.maxTurns} current, ${state.totalTurnsStarted} total`,
    `Last score: ${last ? `${last.score}/${last.targetScore}` : "none"}`,
    `Best score: ${best ? `${best.score}/${best.targetScore} run ${best.run ?? 1}` : "none"}`,
    `Premature stops: ${state.prematureStopCount}`,
    `Target files: ${state.targetContext?.files.length ? state.targetContext.files.map((file) => file.path).join(", ") : "none"}`,
    `Target checks: ${state.targetContext?.checks.length ? state.targetContext.checks.map((check) => check.command).join("; ") : "none"}`,
    `Stop reason: ${state.stopReason ?? "none"}`,
    `Log: ${loopLogPath(cwd)}`,
  ].join("\n");
}

function defaultArgs(command: ParsedLoopArgs["command"]): ParsedLoopArgs {
  return { command, goal: "", minutes: DEFAULT_MINUTES, turns: DEFAULT_TURNS, target: DEFAULT_TARGET, runs: DEFAULT_RUNS, files: [], symbols: [], checks: [] };
}

function parseStartArgs(tokens: string[]) {
  let minutes = DEFAULT_MINUTES;
  let turns = DEFAULT_TURNS;
  let target = DEFAULT_TARGET;
  let runs = DEFAULT_RUNS;
  const files: string[] = [];
  const symbols: string[] = [];
  const checks: string[] = [];
  const goalTokens: string[] = [];

  for (const token of tokens) {
    const [name, value] = splitFlag(token);
    if (name === "--minutes") minutes = parsePositiveInt(value, DEFAULT_MINUTES, 1, 24 * 60);
    else if (name === "--turns") turns = parsePositiveInt(value, DEFAULT_TURNS, 1, 200);
    else if (name === "--target") target = parsePositiveInt(value, DEFAULT_TARGET, 1, 100);
    else if (name === "--runs") runs = parsePositiveInt(value, DEFAULT_RUNS, 1, MAX_RUNS);
    else if (name === "--file" && value) files.push(value);
    else if (name === "--symbol" && value) symbols.push(value);
    else if (name === "--check" && value) checks.push(value);
    else goalTokens.push(token);
  }

  return { minutes, turns, target, runs, files, symbols, checks, goalTokens };
}

function splitFlag(token: string): [string, string] {
  const index = token.indexOf("=");
  return index === -1 ? [token, ""] : [token.slice(0, index), token.slice(index + 1)];
}

function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of input) {
    if ((char === '"' || char === "'") && quote === null) { quote = char; continue; }
    if (char === quote) { quote = null; continue; }
    if (/\s/.test(char) && quote === null) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function parsePositiveInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
