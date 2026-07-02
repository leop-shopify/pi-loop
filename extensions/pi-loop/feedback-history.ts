import { COMPACT_SCORE_TREND_LIMIT, DETAILED_RECENT_ATTEMPTS, MAX_FEEDBACK_HISTORY_CHARS } from "./constants.ts";
import { feedbackMessageKey, refineNextActions } from "./feedback-refinement.ts";
import { metricTrendLines } from "./metric-feedback.ts";
import { bestProgressEntry, shortProgressPercent } from "./progress.ts";
import { bestScore, type LoopRuntimeState, type LoopScoreEntry } from "./state.ts";

export function formatFeedbackHistory(state: LoopRuntimeState, maxChars = MAX_FEEDBACK_HISTORY_CHARS): string {
  const sections = [scoreTrend(state.results), metricTrend(state), plateauAnalysis(state.results), bestAttempt(state), recentDetails(state), recurringBlockers(state)].filter(Boolean);
  const text = sections.join("\n\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 12)}\n...truncated`;
}

function scoreTrend(results: LoopScoreEntry[]): string {
  if (results.length === 0) return "Progress trend: none";
  const entries = compactTrend(results).map((entry) => `r${entry.run ?? 1}t${entry.turn}:${shortProgressPercent(entry.progressPercent ?? null)}${entry.outcome ? `/${entry.outcome}` : ""}`);
  return `Progress trend: ${entries.join(", ")}`;
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

function metricTrend(state: LoopRuntimeState): string {
  const lines = metricTrendLines(state.targetContext?.objectives ?? [], state.results);
  if (lines.length === 0) return "";
  return ["Measured metric trend:", ...lines.map((line) => `- ${line}`)].join("\n");
}

function plateauAnalysis(results: LoopScoreEntry[]): string {
  if (results.length < 2) return "Plateau analysis: none";
  const last = results.at(-1);
  if (!last) return "Plateau analysis: none";
  const streak = trailingProgressStreak(results, last.progressPercent ?? null);
  if (streak < 2) return "Plateau analysis: none";
  return `Plateau analysis: ${shortProgressPercent(last.progressPercent ?? null)} repeated for ${streak} consecutive attempts; branch to a different strategy or add new evidence.`;
}

function trailingProgressStreak(results: LoopScoreEntry[], progress: number | null): number {
  let count = 0;
  for (let index = results.length - 1; index >= 0; index--) {
    if ((results[index].progressPercent ?? null) !== progress) break;
    count++;
  }
  return count;
}

function bestAttempt(state: LoopRuntimeState): string {
  const best = bestProgressEntry(state) ?? bestScore(state);
  if (!best) return "Best attempt: none";
  return [
    `Best attempt: run ${best.run ?? 1}, turn ${best.turn}, progress ${shortProgressPercent(best.progressPercent ?? null)}`,
    `Summary: ${best.summary}`,
    `Top blockers: ${best.blockers.slice(0, 3).map((blocker) => blocker.message).join("; ") || "none"}`,
    `Top next actions: ${refineNextActions(best.nextActions).slice(0, 3).join("; ") || "none"}`,
  ].join("\n");
}

function recentDetails(state: LoopRuntimeState): string {
  const recent = state.results.filter((entry) => (entry.run ?? 1) === state.currentRun).slice(-DETAILED_RECENT_ATTEMPTS);
  if (recent.length === 0) return "Recent detailed feedback: none";
  return [`Recent detailed feedback:`, ...recent.map(formatAttempt)].join("\n");
}

function formatAttempt(entry: LoopScoreEntry): string {
  const gaps = entry.categories.flatMap((category) => (category.score / category.max < 0.8 ? (category.gaps ?? [`${category.key} ${category.score}/${category.max}`]).slice(0, 1) : []));
  const experiment = entry.hypothesis ? `; hypothesis: ${entry.hypothesis}${entry.verdict ? ` → ${entry.verdict}` : ""}` : entry.verdict ? `; verdict: ${entry.verdict}` : "";
  return `- r${entry.run ?? 1}t${entry.turn} ${shortProgressPercent(entry.progressPercent ?? null)}: blockers ${entry.blockers.map((blocker) => blocker.message).slice(0, 2).join("; ") || "none"}; gaps ${gaps.slice(0, 3).join("; ") || "none"}${experiment}`;
}

function recurringBlockers(state: LoopRuntimeState): string {
  const counts = new Map<string, { message: string; count: number }>();
  for (const entry of state.results) {
    for (const blocker of entry.blockers) {
      const key = feedbackMessageKey(blocker.message);
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { message: blocker.message, count: 1 });
    }
  }
  const recurring = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 3);
  return `Recurring blockers: ${recurring.length ? recurring.map(({ message, count }) => `${message} (${count})`).join("; ") : "none"}`;
}
