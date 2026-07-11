import { DEFAULT_MINUTES, DEFAULT_RUNS, DEFAULT_TARGET, DEFAULT_TURNS } from "./constants.ts";
import type { MeasuredMetric } from "./objectives.ts";
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
  sessionId?: string;
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

export interface LoopTurnDuration {
  run: number;
  turn: number;
  globalTurn: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface LoopContextUsageSnapshot {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface LoopStepHistoryEntry {
  step: string;
  detail?: string;
  run: number;
  turn: number;
  globalTurn: number;
  timestamp: number;
}

export interface LoopPendingFeedbackTurn {
  run: number;
  turn: number;
  globalTurn: number;
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
  baselineScore?: number | null;
  progressPercent?: number | null;
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
  metrics?: MeasuredMetric[];
  hypothesis?: string;
  verdict?: "keep" | "discard";
}

export interface LoopScoreEntryExtras {
  metrics?: MeasuredMetric[];
  hypothesis?: string;
  verdict?: "keep" | "discard";
}

export interface LoopEventEntry {
  type: "event";
  schemaVersion?: 2;
  timestamp: number;
  event: "stopped" | "cleared" | "limit_reached" | "resumed" | "run_started" | "run_stopped" | "turn_started" | "missing_score" | "delegation_pending" | "premature_stop" | "loop_step";
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
  sessionId: string | null;
  turnsStarted: number;
  lastAgentStartScoreCount: number;
  unscoredConsecutiveTurns: number;
  pendingFeedbackTurn: LoopPendingFeedbackTurn | null;
  delegationPending: boolean;
  delegationExpectedReports: number;
  delegationReportsReceived: number;
  delegationObservedActive: boolean;
  pendingResumeTimer: ReturnType<typeof setTimeout> | null;
  pausedMs: number;
  timerPausedAt: number | null;
  results: LoopScoreEntry[];
  runs: LoopRunState[];
  prematureStopCount: number;
  stopReason: string | null;
  targetContext: TargetContextSnapshot | null;
  currentPrompt: string | null;
  currentTurnStartedAt: number | null;
  lastTurnDurationMs: number | null;
  turnDurations: LoopTurnDuration[];
  contextUsage: LoopContextUsageSnapshot | null;
  stepHistory: LoopStepHistoryEntry[];
  panelVisible: boolean;
}

export interface LoopStartOptions {
  goal: string;
  targetScore: number;
  maxTurns: number;
  maxMinutes: number;
  maxRuns?: number;
  startedAt?: number;
  targetContext?: TargetContextSnapshot;
  sessionId?: string;
}

export function createLoopState(): LoopRuntimeState {
  return {
    active: false,
    goal: null,
    targetScore: DEFAULT_TARGET,
    maxTurns: DEFAULT_TURNS,
    maxMinutes: DEFAULT_MINUTES,
    maxRuns: DEFAULT_RUNS,
    currentRun: 1,
    totalTurnsStarted: 0,
    startedAt: null,
    sessionId: null,
    turnsStarted: 0,
    lastAgentStartScoreCount: 0,
    unscoredConsecutiveTurns: 0,
    pendingFeedbackTurn: null,
    delegationPending: false,
    delegationExpectedReports: 0,
    delegationReportsReceived: 0,
    delegationObservedActive: false,
    pendingResumeTimer: null,
    pausedMs: 0,
    timerPausedAt: null,
    results: [],
    runs: [],
    prematureStopCount: 0,
    stopReason: null,
    targetContext: null,
    currentPrompt: null,
    currentTurnStartedAt: null,
    lastTurnDurationMs: null,
    turnDurations: [],
    contextUsage: null,
    stepHistory: [],
    panelVisible: true,
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
    sessionId: options.sessionId ?? null,
    targetContext: options.targetContext ?? null,
    runs: [{ index: 1, startedAt, turnsStarted: 0 }],
  });
  return { type: "config", schemaVersion: 2, goal: state.goal ?? "", targetScore: state.targetScore, maxTurns: state.maxTurns, maxMinutes: state.maxMinutes, maxRuns: state.maxRuns, startedAt, sessionId: state.sessionId ?? undefined, targetContext: state.targetContext ?? undefined };
}

export function elapsedMs(state: LoopRuntimeState, now: number = Date.now()): number {
  if (state.startedAt === null) return 0;
  const pausedMs = state.pausedMs ?? 0;
  const activePauseMs = state.timerPausedAt === null || state.timerPausedAt === undefined ? 0 : Math.max(0, now - state.timerPausedAt);
  return Math.max(0, now - state.startedAt - pausedMs - activePauseMs);
}

export function pauseLoopTimer(state: LoopRuntimeState, now: number = Date.now()): void {
  if (!state.active || state.timerPausedAt !== null) return;
  state.timerPausedAt = now;
}

export function resumeLoopTimer(state: LoopRuntimeState, now: number = Date.now()): void {
  if (state.timerPausedAt === null || state.timerPausedAt === undefined) return;
  state.pausedMs = (state.pausedMs ?? 0) + Math.max(0, now - state.timerPausedAt);
  state.timerPausedAt = null;
}

export function deadlineReached(state: LoopRuntimeState, now: number = Date.now()): boolean {
  return state.startedAt !== null && elapsedMs(state, now) >= state.maxMinutes * 60_000;
}

export function turnLimitReached(state: LoopRuntimeState): boolean {
  return normalTurnsStarted(state) >= state.maxTurns;
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

export function acceptanceReadyTurn(state: LoopRuntimeState): number | null {
  const first = state.results[0];
  const legacyReadyTurn = first && first.attempt?.acceptanceStatus === undefined ? 0 : null;
  if (legacyReadyTurn !== null) return legacyReadyTurn;
  const ready = state.results.find((entry) => {
    const attempt = entry.attempt;
    return attempt?.acceptanceStatus === "confirmed" && (attempt.acceptanceCriteria?.length ?? 0) > 0 && (attempt.planTasks?.length ?? 0) > 0;
  });
  return ready ? ready.globalTurn ?? ready.turn : null;
}

export function acceptanceReady(state: LoopRuntimeState): boolean {
  return acceptanceReadyTurn(state) !== null;
}

export function completionClaimed(state: LoopRuntimeState): boolean {
  const attempt = lastScore(state)?.attempt;
  if (!attempt || attempt.stopIntent !== "claim_done" || !acceptanceReady(state)) return false;
  const tasks = attempt.planTasks ?? [];
  return tasks.length > 0 && tasks.every((task) => task.status === "completed");
}

export function confirmationPassCount(state: LoopRuntimeState): number {
  let count = 0;
  for (let index = state.results.length - 1; index >= 0; index--) {
    if (state.results[index].attempt?.stopIntent !== "claim_done") break;
    count++;
  }
  return count;
}

export function normalWorkStarted(state: LoopRuntimeState): boolean {
  return normalTurnsStarted(state) > 0;
}

export function normalTurnsStarted(state: LoopRuntimeState): number {
  const readyTurn = acceptanceReadyTurn(state);
  if (readyTurn === null) return 0;
  if (state.currentRun > 1) return state.turnsStarted;
  return Math.max(0, state.turnsStarted - readyTurn);
}

export function normalTotalTurnsStarted(state: LoopRuntimeState): number {
  const readyTurn = acceptanceReadyTurn(state);
  if (readyTurn === null) return 0;
  return Math.max(0, state.totalTurnsStarted - readyTurn);
}

export function previousScoreValue(state: LoopRuntimeState): number | null {
  return lastScore(state)?.score ?? null;
}

export function baselineScoreValue(state: LoopRuntimeState): number | null {
  return state.results[0]?.score ?? null;
}

export function stopLoop(state: LoopRuntimeState, reason: string): void {
  state.active = false;
  state.stopReason = reason;
  if (state.pendingResumeTimer) {
    clearTimeout(state.pendingResumeTimer);
    state.pendingResumeTimer = null;
  }
}

export function scoreEntryFromResult(turn: number, summary: string, result: LoopScoreResult, attempt?: AttemptEvidence, run = 1, globalTurn = turn, extras: LoopScoreEntryExtras = {}): LoopScoreEntry {
  return { type: "score", schemaVersion: 2, run, turn, globalTurn, timestamp: Date.now(), summary, score: result.score, rawScore: result.rawScore, targetScore: result.targetScore, baselineScore: result.baselineScore, progressPercent: result.progressPercent, passedDefinition: result.passedDefinition, improvement: result.improvement, blockers: result.blockers.map((blocker) => ({ severity: blocker.severity, message: blocker.message, evidence: blocker.evidence })), strengths: result.strengths, nextActions: result.nextActions, categories: result.categories.map((category) => ({ key: category.key, label: category.label, score: category.score, max: category.max, evidence: category.evidence, gaps: category.gaps })), outcome: result.outcome, verifierFindings: result.verifierFindings, attempt, result, metrics: extras.metrics?.length ? extras.metrics : undefined, hypothesis: extras.hypothesis, verdict: extras.verdict };
}
