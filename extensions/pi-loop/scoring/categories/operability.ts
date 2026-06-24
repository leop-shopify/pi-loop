import { buildCategory } from "../category.ts";
import { boolScore, nonEmpty } from "../evidence.ts";
import type { CategoryScore, LoopScoreInput } from "../types.ts";

export function scoreOperability(input: LoopScoreInput): CategoryScore {
  const operability = input.operability;
  const evidence: string[] = [];
  const gaps: string[] = [];
  let score = 0;

  if (!operability) return buildCategory("operability", 0, evidence, ["No structured operability evidence was provided."]);

  score += boolScore(operability.limitsDefined, 1);
  score += boolScore(operability.persistenceDefined, 1);
  score += boolScore(operability.loggingAvailable, 1);
  score += boolScore(operability.rollbackOrRecoveryDefined, 1);
  score += boolScore(operability.humanStopAvailable, 1);

  if (operability.limitsDefined) evidence.push("Limits are defined.");
  else gaps.push("Limits were not shown.");
  if (operability.persistenceDefined) evidence.push("Persistence is defined.");
  else gaps.push("Persistence was not shown.");
  if (operability.loggingAvailable) evidence.push("Logging or evidence trail exists.");
  else gaps.push("Logging or evidence trail was not shown.");
  if (operability.rollbackOrRecoveryDefined) evidence.push("Rollback or recovery was covered.");
  else gaps.push("Rollback or recovery was not shown.");
  if (operability.humanStopAvailable) evidence.push("Human stop is available.");
  else gaps.push("Human stop was not shown.");
  if (nonEmpty(operability.evidence)) evidence.push(operability.evidence!);

  return buildCategory("operability", score, evidence, gaps);
}
