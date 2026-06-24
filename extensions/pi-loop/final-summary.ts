import { formatProgressPercent } from "./progress.ts";
import type { LoopRuntimeState, LoopScoreEntry } from "./state.ts";

export function finalLoopSummary(state: LoopRuntimeState, reason: string): string {
  const progress = bestProgress(state);
  return [
    "pi-loop finished",
    "",
    `TL;DR: ${tldr(state, reason, progress)}`,
    "",
    "Accomplished:",
    `- Goal: ${state.goal ?? "unknown"}`,
    `- Result: ${progress?.summary ?? reason}`,
    `- Stop reason: ${reason}`,
    `- Best progress: ${progress ? `${formatProgressPercent(progress.progressPercent ?? null)} in run ${progress.run ?? 1}, turn ${progress.turn}` : "none"}`,
    "",
    "Loop steps:",
    ...stepLines(state),
  ].join("\n");
}

function tldr(state: LoopRuntimeState, reason: string, progress: LoopScoreEntry | null): string {
  if (!state.results.length) return `Stopped before any recorded attempt for ${state.goal ?? "the goal"}.`;
  return `Stopped after ${state.results.length} recorded attempt${state.results.length === 1 ? "" : "s"}; ${reason}. Best progress ${formatProgressPercent(progress?.progressPercent ?? null)}.`;
}

function stepLines(state: LoopRuntimeState): string[] {
  if (!state.results.length) return ["- No loop attempts were recorded."];
  return state.results.map((entry) => {
    const parts = [
      `run ${entry.run ?? 1}, turn ${entry.turn}`,
      formatProgressPercent(entry.progressPercent ?? null),
      entry.summary,
    ];
    const actions = entry.attempt?.actionsTaken?.slice(0, 3);
    const suffix = actions?.length ? ` Steps: ${actions.join("; ")}.` : "";
    const blockers = entry.blockers.filter((blocker) => blocker.severity === "blocker").slice(0, 2);
    const blockerText = blockers.length ? ` Blockers: ${blockers.map((blocker) => blocker.message).join("; ")}.` : "";
    return `- ${parts.join(" — ")}.${suffix}${blockerText}`;
  });
}

function bestProgress(state: LoopRuntimeState): LoopScoreEntry | null {
  return [...state.results]
    .filter((entry) => typeof entry.progressPercent === "number")
    .sort((a, b) => (b.progressPercent ?? Number.NEGATIVE_INFINITY) - (a.progressPercent ?? Number.NEGATIVE_INFINITY))[0]
    ?? state.results.at(-1)
    ?? null;
}
