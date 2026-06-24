import type { TargetContextSnapshot } from "./target-context.ts";
import type { AttemptEvidence, EvidenceVerificationFinding, LoopFeedbackOutcome, LoopScoreResult } from "./scoring-heuristics.ts";

export interface LoopConfigEntry {
  type: "config";
  schemaVersion?: 2;
  goal: string;
  targetScore: number;
  maxTurns: number;
  maxMinutes: number;
  maxRuns?: number;
  startedAt: number;
  targetContext?: TargetContextSnapshot;
  context?: TargetContextSnapshot;
}

export interface LoopRunState {
  index: number;
  startedAt: number;
  endedAt?: number;
  turnsStarted: number;
  stopReason?: string;
  bestScore?: number;
}

export interface LoopScoreEntry {
  type: "score";
  schemaVersion?: 2;
  run?: number;
  turn: number;
  globalTurn?: number;
  timestamp: number;
  summary: string;
  score: number;
  rawScore: number;
  targetScore: number;
  passedDefinition: boolean;
  improvement: number | null;
  blockers: Array<{ severity: string; message: string; evidence?: string }>;
  strengths?: string[];
  nextActions: string[];
  categories: Array<{ key: string; label?: string; score: number; max: number; evidence?: string[]; gaps?: string[] }>;
  outcome?: LoopFeedbackOutcome;
  verifierFindings?: EvidenceVerificationFinding[];
  attempt?: AttemptEvidence;
  result?: LoopScoreResult;
}

export interface LoopEventEntry {
  type: "event";
  schemaVersion?: 2;
  timestamp: number;
  event: "stopped" | "cleared" | "limit_reached" | "resumed" | "run_started" | "run_stopped" | "missing_score" | "premature_stop";
  reason?: string;
  run?: number;
  turn?: number;
  globalTurn?: number;
  score?: number;
  targetScore?: number;
  bestScore?: number;
  details?: Record<string, unknown>;
}

export type LoopLogEntry = LoopConfigEntry | LoopScoreEntry | LoopEventEntry;

export interface LoopRuntimeState {
  active: boolean;
  goal: string | null;
  targetScore: number;
  maxTurns: number;
  maxMinutes: number;
  maxRuns: number;
  currentRun: number;
  totalTurnsStarted: number;
  startedAt: number | null;
  turnsStarted: number;
  lastAgentStartScoreCount: number;
  unscoredConsecutiveTurns: number;
  pendingResumeTimer: ReturnType<typeof setTimeout> | null;
  results: LoopScoreEntry[];
  runs: LoopRunState[];
  prematureStopCount: number;
  stopReason: string | null;
  targetContext: TargetContextSnapshot | null;
}

export interface LoopStartOptions {
  goal: string;
  targetScore: number;
  maxTurns: number;
  maxMinutes: number;
  maxRuns?: number;
  startedAt?: number;
  targetContext?: TargetContextSnapshot;
}

export function createLoopState(): LoopRuntimeState {
  return {
    active: false,
    goal: null,
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 60,
    maxRuns: 1,
    currentRun: 1,
    totalTurnsStarted: 0,
    startedAt: null,
    turnsStarted: 0,
    lastAgentStartScoreCount: 0,
    unscoredConsecutiveTurns: 0,
    pendingResumeTimer: null,
    results: [],
    runs: [],
    prematureStopCount: 0,
    stopReason: null,
    targetContext: null,
  };
}

export function startLoopState(state: LoopRuntimeState, options: LoopStartOptions): LoopConfigEntry {
  const startedAt = options.startedAt ?? Date.now();
  Object.assign(state, createLoopState(), {
    active: true,
    goal: options.goal,
    targetScore: options.targetScore,
    maxTurns: options.maxTurns,
    maxMinutes: options.maxMinutes,
    maxRuns: options.maxRuns ?? 1,
    startedAt,
    targetContext: options.targetContext ?? null,
    runs: [{ index: 1, startedAt, turnsStarted: 0 }],
  });
  return { type: "config", schemaVersion: 2, goal: state.goal ?? "", targetScore: state.targetScore, maxTurns: state.maxTurns, maxMinutes: state.maxMinutes, maxRuns: state.maxRuns, startedAt, targetContext: state.targetContext ?? undefined };
}

export function elapsedMs(state: LoopRuntimeState, now: number = Date.now()): number {
  return state.startedAt === null ? 0 : Math.max(0, now - state.startedAt);
}

export function deadlineReached(state: LoopRuntimeState, now: number = Date.now()): boolean {
  return state.startedAt !== null && elapsedMs(state, now) >= state.maxMinutes * 60_000;
}

export function turnLimitReached(state: LoopRuntimeState): boolean {
  return state.turnsStarted >= state.maxTurns;
}

export function lastScore(state: LoopRuntimeState): LoopScoreEntry | null {
  return state.results[state.results.length - 1] ?? null;
}

export function lastScoreForRun(state: LoopRuntimeState, run: number = state.currentRun): LoopScoreEntry | null {
  return state.results.filter((entry) => (entry.run ?? 1) === run).at(-1) ?? null;
}

export function bestScore(state: LoopRuntimeState): LoopScoreEntry | null {
  return [...state.results].sort((a, b) => b.score - a.score)[0] ?? null;
}

export function previousScoreValue(state: LoopRuntimeState): number | null {
  return lastScoreForRun(state)?.score ?? null;
}

export function passedDefinition(state: LoopRuntimeState): boolean {
  return lastScore(state)?.passedDefinition === true;
}

export function stopLoop(state: LoopRuntimeState, reason: string): void {
  state.active = false;
  state.stopReason = reason;
  if (state.pendingResumeTimer) {
    clearTimeout(state.pendingResumeTimer);
    state.pendingResumeTimer = null;
  }
}

export function scoreEntryFromResult(turn: number, summary: string, result: LoopScoreResult, attempt?: AttemptEvidence, run = 1, globalTurn = turn): LoopScoreEntry {
  return { type: "score", schemaVersion: 2, run, turn, globalTurn, timestamp: Date.now(), summary, score: result.score, rawScore: result.rawScore, targetScore: result.targetScore, passedDefinition: result.passedDefinition, improvement: result.improvement, blockers: result.blockers.map((blocker) => ({ severity: blocker.severity, message: blocker.message, evidence: blocker.evidence })), strengths: result.strengths, nextActions: result.nextActions, categories: result.categories.map((category) => ({ key: category.key, label: category.label, score: category.score, max: category.max, evidence: category.evidence, gaps: category.gaps })), outcome: result.outcome, verifierFindings: result.verifierFindings, attempt, result };
}
