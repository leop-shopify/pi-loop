const STALE_STOP_ACTION = /\b(verify|verifies|verified)\b.*\b(progress|improvement)\b.*\b(stop|stopping)\b|\b(stop|stopping)\b.*\b(progress|improvement)\b/i;
const STALE_BASELINE_ACTION = /\bimprove over the baseline attempt\b|\bcurrent progress is [+-]?\d+(?:\.\d+)?%\b/i;
const BASELINE_STOP_ACTION = "Treat baseline progress as feedback only; choose a materially different next action and score again.";

export function refineNextAction(action: string): string | null {
  const trimmed = action.trim();
  if (!trimmed) return null;
  if (STALE_STOP_ACTION.test(trimmed)) return BASELINE_STOP_ACTION;
  if (STALE_BASELINE_ACTION.test(trimmed)) return BASELINE_STOP_ACTION;
  return trimmed;
}

export function refineNextActions(actions: readonly string[], fallback = "Choose a materially different next action and score again."): string[] {
  const refined = actions.map(refineNextAction).filter((action): action is string => action !== null);
  return dedupe(refined.length ? refined : [fallback]);
}

export function feedbackMessageKey(message: string): string {
  return message
    .toLowerCase()
    .replace(/\bno remote ci has run\b|\bremote ci has not run\b/g, "remote ci has not run")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
