import { CATEGORY_LABELS, CATEGORY_MAX } from "./rubric.ts";
import type { CategoryKey, CategoryScore } from "./types.ts";
import { clamp } from "./evidence.ts";

export function buildCategory(key: CategoryKey, score: number, evidence: string[], gaps: string[]): CategoryScore {
  const max = CATEGORY_MAX[key];
  return {
    key,
    label: CATEGORY_LABELS[key],
    score: clamp(Math.round(score), 0, max),
    max,
    evidence,
    gaps,
  };
}
