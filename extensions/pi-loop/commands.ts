import { DEFAULT_MINUTES, DEFAULT_RUNS, DEFAULT_TARGET, DEFAULT_TURNS, MAX_MINUTES, MAX_RUNS, MAX_TURNS } from "./constants.ts";
import { loopLogPath } from "./paths.ts";
import { bestProgressEntry, formatProgressPercent } from "./progress.ts";
import { formatRuntimeSteps } from "./runtime-steps.ts";
import { type LoopRuntimeState } from "./state.ts";

export interface ParsedLoopArgs {
  command: "start" | "status" | "off" | "clear" | "hide" | "show" | "toggle" | "help";
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
  if (lower === "hide") return defaultArgs("hide");
  if (lower === "show") return defaultArgs("show");
  if (lower === "toggle") return defaultArgs("toggle");
  if (lower === "help") return defaultArgs("help");

  const parsed = parseStartArgs(tokenizeArgs(trimmed));
  return { command: parsed.goalTokens.length > 0 ? "start" : "help", goal: parsed.goalTokens.join(" "), minutes: parsed.minutes, turns: parsed.turns, target: parsed.target, runs: parsed.runs, files: parsed.files, symbols: parsed.symbols, checks: parsed.checks };
}

export function goalHelp(): string {
  return [
    "Usage: /goal <objective> [--minutes=10] [--turns=12] [--target=90] [--runs=1]",
    "       /goal <objective> [--file=path] [--symbol=Name] [--check=\"pnpm test\"]",
    "       /goal status",
    "       /pi-goal hide | show | toggle",
    "       /goal stop | off",
    "       /goal clear",
    "",
    "The first score is a baseline; later scores are feedback. Minutes and turns are capped at 10 minutes and 12 total attempts so unfinished work should carry into the next attempt.",
  ].join("\n");
}

export const loopHelp = goalHelp;

export function statusText(state: LoopRuntimeState, cwd: string): string {
  const last = state.results[state.results.length - 1];
  const best = bestProgressEntry(state);
  return [
    `Active: ${state.active ? "yes" : "no"}`,
    `Goal: ${state.goal ?? "none"}`,
    `Run: ${state.currentRun}/${state.maxRuns}`,
    `Turns: ${state.turnsStarted}/${state.maxTurns} current, ${state.totalTurnsStarted} total`,
    `Last progress: ${last ? formatProgressPercent(last.progressPercent ?? null) : "none"}`,
    `Best progress: ${best ? `${formatProgressPercent(best.progressPercent ?? null)} run ${best.run ?? 1}` : "none"}`,
    `Premature stops: ${state.prematureStopCount}`,
    `Target files: ${state.targetContext?.files.length ? state.targetContext.files.map((file) => file.path).join(", ") : "none"}`,
    `Target checks: ${state.targetContext?.checks.length ? state.targetContext.checks.map((check) => check.command).join("; ") : "none"}`,
    `Stop reason: ${state.stopReason ?? "none"}`,
    `Log: ${loopLogPath(cwd)}`,
    "",
    formatRuntimeSteps(state),
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
    if (name === "--minutes") minutes = parsePositiveInt(value, DEFAULT_MINUTES, 1, MAX_MINUTES);
    else if (name === "--turns") turns = parsePositiveInt(value, DEFAULT_TURNS, 1, MAX_TURNS);
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
