import { COMPACT_SCORE_TREND_LIMIT, DETAILED_RECENT_ATTEMPTS, MAX_FEEDBACK_HISTORY_CHARS } from "./constants.ts";
import { bestScore, type LoopRuntimeState, type LoopScoreEntry } from "./state.ts";

export function formatFeedbackHistory(state: LoopRuntimeState, maxChars = MAX_FEEDBACK_HISTORY_CHARS): string {
  const sections = [scoreTrend(state.results), bestAttempt(state), recentDetails(state), recurringBlockers(state)].filter(Boolean);
  const text = sections.join("\n\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 12)}\n...truncated`;
}

function scoreTrend(results: LoopScoreEntry[]): string {
  if (results.length === 0) return "Score trend: none";
  const entries = compactTrend(results).map((entry) => `r${entry.run ?? 1}t${entry.turn}:${entry.score}/${entry.targetScore}${entry.outcome ? `/${entry.outcome}` : ""}`);
  return `Score trend: ${entries.join(", ")}`;
}

function compactTrend(results: LoopScoreEntry[]): LoopScoreEntry[] {
  if (results.length <= COMPACT_SCORE_TREND_LIMIT) return results;
  const first = results.slice(0, 3);
  const best = [...results].sort((a, b) => b.score - a.score).slice(0, 3);
  const last = results.slice(-10);
  const seen = new Set<string>();
  return [...first, ...best, ...last].filter((entry) => {
    const key = `${entry.run ?? 1}:${entry.turn}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bestAttempt(state: LoopRuntimeState): string {
  const best = bestScore(state);
  if (!best) return "Best attempt: none";
  return [
    `Best attempt: run ${best.run ?? 1}, turn ${best.turn}, score ${best.score}/${best.targetScore}`,
    `Summary: ${best.summary}`,
    `Top blockers: ${best.blockers.slice(0, 3).map((blocker) => blocker.message).join("; ") || "none"}`,
    `Top next actions: ${best.nextActions.slice(0, 3).join("; ") || "none"}`,
  ].join("\n");
}

function recentDetails(state: LoopRuntimeState): string {
  const recent = state.results.filter((entry) => (entry.run ?? 1) === state.currentRun).slice(-DETAILED_RECENT_ATTEMPTS);
  if (recent.length === 0) return "Recent detailed feedback: none";
  return [`Recent detailed feedback:`, ...recent.map(formatAttempt)].join("\n");
}

function formatAttempt(entry: LoopScoreEntry): string {
  const gaps = entry.categories.flatMap((category) => (category.score / category.max < 0.8 ? (category.gaps ?? [`${category.key} ${category.score}/${category.max}`]).slice(0, 1) : []));
  return `- r${entry.run ?? 1}t${entry.turn} ${entry.score}/${entry.targetScore}: blockers ${entry.blockers.map((blocker) => blocker.message).slice(0, 2).join("; ") || "none"}; gaps ${gaps.slice(0, 3).join("; ") || "none"}`;
}

function recurringBlockers(state: LoopRuntimeState): string {
  const counts = new Map<string, number>();
  for (const entry of state.results) for (const blocker of entry.blockers) counts.set(blocker.message, (counts.get(blocker.message) ?? 0) + 1);
  const recurring = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return `Recurring blockers: ${recurring.length ? recurring.map(([message, count]) => `${message} (${count})`).join("; ") : "none"}`;
}
