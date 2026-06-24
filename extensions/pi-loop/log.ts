import * as fs from "node:fs";

import { ensureParentDir, loopLogPath } from "./paths.ts";
import { createLoopState, deadlineReached, passedDefinition, turnLimitReached, type LoopConfigEntry, type LoopEventEntry, type LoopLogEntry, type LoopRuntimeState, type LoopScoreEntry } from "./state.ts";

export function appendLogEntry(cwd: string, entry: LoopLogEntry): void {
  const filePath = loopLogPath(cwd);
  ensureParentDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
}

export function replaceLog(cwd: string, entries: LoopLogEntry[]): void {
  const filePath = loopLogPath(cwd);
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
}

export function deleteLog(cwd: string): boolean {
  const filePath = loopLogPath(cwd);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function readLogEntries(cwd: string): LoopLogEntry[] {
  const filePath = loopLogPath(cwd);
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf-8").split("\n").filter(Boolean).map(parseEntry).filter((entry): entry is LoopLogEntry => entry !== null);
}

export function reconstructLoopState(cwd: string, now: number = Date.now()): LoopRuntimeState {
  const state = createLoopState();
  for (const entry of readLogEntries(cwd)) applyLogEntry(state, entry);
  const exhausted = state.currentRun >= state.maxRuns && turnLimitReached(state);
  if (state.goal && !state.stopReason && !passedDefinition(state) && !deadlineReached(state, now) && !exhausted) state.active = true;
  return state;
}

function applyLogEntry(state: LoopRuntimeState, entry: LoopLogEntry): void {
  if (entry.type === "config") {
    Object.assign(state, createLoopState(), {
      goal: entry.goal,
      targetScore: entry.targetScore,
      maxTurns: entry.maxTurns,
      maxMinutes: entry.maxMinutes,
      maxRuns: entry.maxRuns ?? 1,
      startedAt: entry.startedAt,
      targetContext: entry.targetContext ?? entry.context ?? null,
      runs: [{ index: 1, startedAt: entry.startedAt, turnsStarted: 0 }],
    });
    return;
  }

  if (entry.type === "score") {
    const normalized = { ...entry, run: entry.run ?? 1, globalTurn: entry.globalTurn ?? entry.turn };
    state.results.push(normalized);
    state.currentRun = Math.max(state.currentRun, normalized.run ?? 1);
    state.turnsStarted = Math.max(state.turnsStarted, normalized.turn);
    state.totalTurnsStarted = Math.max(state.totalTurnsStarted, normalized.globalTurn ?? normalized.turn);
    ensureRun(state, normalized.run ?? 1).turnsStarted = state.turnsStarted;
    return;
  }

  applyEventEntry(state, entry);
}

function applyEventEntry(state: LoopRuntimeState, entry: LoopEventEntry): void {
  if (entry.event === "run_started" && entry.run) {
    state.currentRun = entry.run;
    state.turnsStarted = 0;
    ensureRun(state, entry.run).startedAt = entry.timestamp;
    return;
  }
  if (entry.event === "run_stopped" && entry.run) {
    const run = ensureRun(state, entry.run);
    run.endedAt = entry.timestamp;
    run.stopReason = entry.reason;
    run.bestScore = entry.bestScore;
    return;
  }
  if (entry.event === "missing_score") state.unscoredConsecutiveTurns++;
  if (entry.event === "premature_stop") state.prematureStopCount++;
  if (entry.event === "stopped" || entry.event === "cleared" || entry.event === "limit_reached") state.stopReason = entry.reason ?? entry.event;
}

function ensureRun(state: LoopRuntimeState, index: number) {
  let run = state.runs.find((item) => item.index === index);
  if (!run) {
    run = { index, startedAt: state.startedAt ?? Date.now(), turnsStarted: 0 };
    state.runs.push(run);
  }
  return run;
}

function parseEntry(line: string): LoopLogEntry | null {
  try {
    const parsed = JSON.parse(line) as Partial<LoopLogEntry>;
    if (parsed.type === "config" && typeof parsed.goal === "string") return parsed as LoopConfigEntry;
    if (parsed.type === "score" && typeof parsed.score === "number") return parsed as LoopScoreEntry;
    if (parsed.type === "event" && typeof parsed.event === "string") return parsed as LoopEventEntry;
    return null;
  } catch {
    return null;
  }
}
