import * as fs from "node:fs";

import { ensureParentDir, loopLogPath } from "./paths.ts";
import { createLoopState, deadlineReached, resumeLoopTimer, turnLimitReached, type LoopConfigEntry, type LoopEventEntry, type LoopLogEntry, type LoopRuntimeState, type LoopScoreEntry } from "./state.ts";

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

export function reconstructLoopState(cwd: string, now: number = Date.now(), sessionId?: string): LoopRuntimeState {
  const state = createLoopState();
  for (const entry of readLogEntries(cwd)) applyLogEntry(state, entry, sessionId);
  const exhausted = state.currentRun >= state.maxRuns && turnLimitReached(state);
  if (state.goal && !state.stopReason && !deadlineReached(state, now) && !exhausted) state.active = true;
  return state;
}

function applyLogEntry(state: LoopRuntimeState, entry: LoopLogEntry, sessionId?: string): void {
  if (entry.type === "config") {
    if (sessionId && entry.sessionId !== sessionId) {
      Object.assign(state, createLoopState());
      return;
    }

    Object.assign(state, createLoopState(), {
      goal: entry.goal,
      targetScore: entry.targetScore,
      maxTurns: entry.maxTurns,
      maxMinutes: entry.maxMinutes,
      maxRuns: entry.maxRuns ?? 1,
      startedAt: entry.startedAt,
      sessionId: entry.sessionId ?? null,
      targetContext: entry.targetContext ?? entry.context ?? null,
      runs: [{ index: 1, startedAt: entry.startedAt, turnsStarted: 0 }],
    });
    return;
  }

  if (entry.type === "score") {
    if (!state.goal) return;
    const normalized = { ...entry, run: entry.run ?? 1, globalTurn: entry.globalTurn ?? entry.turn };
    state.results.push(normalized);
    state.pendingFeedbackTurn = null;
    recordObservedTurn(state, normalized.run ?? 1, normalized.turn, normalized.globalTurn ?? normalized.turn);
    state.timerPausedAt = entry.timestamp;
    return;
  }

  if (!state.goal) return;
  applyEventEntry(state, entry);
}

function applyEventEntry(state: LoopRuntimeState, entry: LoopEventEntry): void {
  if (entry.event === "loop_step") {
    recordLoopStep(state, entry);
    return;
  }
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
  if (entry.event === "turn_started") {
    resumeLoopTimer(state, entry.timestamp);
    state.pendingFeedbackTurn = null;
    state.delegationPending = false;
    state.delegationExpectedReports = 0;
    state.delegationReportsReceived = 0;
    state.delegationObservedActive = false;
    recordObservedTurn(state, entry.run ?? state.currentRun, entry.turn ?? state.turnsStarted + 1, entry.globalTurn ?? entry.turn ?? state.totalTurnsStarted + 1);
    return;
  }
  if ((entry.event === "missing_score" || entry.event === "delegation_pending" || entry.event === "premature_stop") && entry.turn) {
    recordObservedTurn(state, entry.run ?? state.currentRun, entry.turn, entry.globalTurn ?? entry.turn);
  }
  if (entry.event === "missing_score") {
    state.unscoredConsecutiveTurns++;
    state.pendingFeedbackTurn = {
      run: entry.run ?? state.currentRun,
      turn: entry.turn ?? state.turnsStarted,
      globalTurn: entry.globalTurn ?? entry.turn ?? state.totalTurnsStarted,
    };
  }
  if (entry.event === "delegation_pending") {
    const expectedReports = typeof entry.details?.expectedReports === "number"
      ? entry.details.expectedReports
      : typeof entry.details?.spawnedCount === "number" ? entry.details.spawnedCount : 0;
    state.unscoredConsecutiveTurns = 0;
    state.pendingFeedbackTurn = null;
    state.delegationPending = true;
    state.delegationExpectedReports = expectedReports;
    state.delegationReportsReceived = 0;
    const lifecycle = entry.details?.lifecycleSnapshot;
    state.delegationObservedActive = Boolean(lifecycle && typeof lifecycle === "object"
      && (("running" in lifecycle && typeof lifecycle.running === "number" && lifecycle.running > 0)
        || ("queued" in lifecycle && typeof lifecycle.queued === "number" && lifecycle.queued > 0)));
  }
  if (entry.event === "premature_stop") state.prematureStopCount++;
  if (entry.event === "stopped" || entry.event === "cleared" || entry.event === "limit_reached") state.stopReason = entry.reason ?? entry.event;
}

function recordLoopStep(state: LoopRuntimeState, entry: LoopEventEntry): void {
  const details = entry.details ?? {};
  const step = typeof details.step === "string" ? details.step : entry.reason;
  if (!step) return;
  state.stepHistory = [...(state.stepHistory ?? []), {
    step,
    detail: typeof details.detail === "string" ? details.detail : undefined,
    run: typeof details.run === "number" ? details.run : entry.run ?? state.currentRun,
    turn: typeof details.turn === "number" ? details.turn : entry.turn ?? state.turnsStarted,
    globalTurn: typeof details.globalTurn === "number" ? details.globalTurn : entry.globalTurn ?? entry.turn ?? state.totalTurnsStarted,
    timestamp: typeof details.timestamp === "number" ? details.timestamp : entry.timestamp,
  }];
}

function recordObservedTurn(state: LoopRuntimeState, runIndex: number, turn: number, globalTurn: number): void {
  state.currentRun = Math.max(state.currentRun, runIndex);
  state.turnsStarted = Math.max(state.turnsStarted, turn);
  state.totalTurnsStarted = Math.max(state.totalTurnsStarted, globalTurn);
  const run = ensureRun(state, runIndex);
  run.turnsStarted = Math.max(run.turnsStarted, turn);
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
