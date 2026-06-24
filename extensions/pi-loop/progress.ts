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
    .sort((a, b) => (b.progressPercent ?? Number.NEGATIVE_INFINITY) - (a.progressPercent ?? Number.NEGATIVE_INFINITY))[0] ?? null;
}
