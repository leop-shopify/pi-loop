import { MAX_TOTAL_TURNS } from "./constants.ts";
import { bestScore, turnLimitReached, type LoopRuntimeState } from "./state.ts";

export function totalTurnBudgetExceeded(maxRuns: number, maxTurns: number): boolean {
  return maxRuns * maxTurns > MAX_TOTAL_TURNS;
}

export function currentRunCanContinue(state: LoopRuntimeState): boolean {
  return !turnLimitReached(state);
}

export function canStartNextRun(state: LoopRuntimeState): boolean {
  return state.currentRun < state.maxRuns;
}

export function markCurrentRunStopped(state: LoopRuntimeState, reason: string, now: number = Date.now()): void {
  const run = state.runs.find((item) => item.index === state.currentRun);
  if (!run) return;
  run.endedAt = now;
  run.turnsStarted = state.turnsStarted;
  run.stopReason = reason;
  run.bestScore = bestScoreForRun(state, state.currentRun)?.score;
}

export function startNextRun(state: LoopRuntimeState, now: number = Date.now()): void {
  state.currentRun += 1;
  state.turnsStarted = 0;
  state.lastAgentStartScoreCount = state.results.length;
  state.unscoredConsecutiveTurns = 0;
  state.runs.push({ index: state.currentRun, startedAt: now, turnsStarted: 0 });
}

export function bestScoreForRun(state: LoopRuntimeState, run: number) {
  return state.results.filter((entry) => (entry.run ?? 1) === run).sort((a, b) => b.score - a.score)[0] ?? null;
}

export function bestScoreReason(state: LoopRuntimeState): string {
  const best = bestScore(state);
  if (!best) return "all runs exhausted with no score";
  return `all runs exhausted; best score ${best.score}/${best.targetScore} from run ${best.run ?? 1}`;
}

export function runBudgetText(state: LoopRuntimeState): string {
  const currentRun = state.currentRun ?? 1;
  const maxRuns = state.maxRuns ?? 1;
  const totalTurns = state.totalTurnsStarted ?? state.turnsStarted;
  return `run ${currentRun}/${maxRuns}, turn ${Math.min(state.turnsStarted + 1, state.maxTurns)}/${state.maxTurns}, total turns ${totalTurns}/${maxRuns * state.maxTurns}, ${state.maxMinutes} minute global timebox`;
}
