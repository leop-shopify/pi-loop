import type { LoopRuntimeState, LoopScoreEntry } from "./state.ts";

export function formatProgressPercent(value: number | null): string {
  if (value === null) return "baseline recorded";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}% over baseline`;
}

export function shortProgressPercent(value: number | null): string {
  if (value === null) return "baseline";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function progressBarPercent(value: number | null): number {
  if (value === null) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function bestProgressEntry(state: LoopRuntimeState): LoopScoreEntry | null {
  return [...state.results]
    .filter((entry) => typeof entry.progressPercent === "number")
    .sort(compareProgressEntries)[0] ?? null;
}

function compareProgressEntries(a: LoopScoreEntry, b: LoopScoreEntry): number {
  const progressDiff = (b.progressPercent ?? Number.NEGATIVE_INFINITY) - (a.progressPercent ?? Number.NEGATIVE_INFINITY);
  if (progressDiff !== 0) return progressDiff;
  const scoreDiff = b.score - a.score;
  if (scoreDiff !== 0) return scoreDiff;
  const turnDiff = (b.globalTurn ?? b.turn) - (a.globalTurn ?? a.turn);
  if (turnDiff !== 0) return turnDiff;
  return b.timestamp - a.timestamp;
}
