import { buildCategory } from "../category.ts";
import { checkHasCommandEvidence, failedRequiredChecks, nonEmpty } from "../evidence.ts";
import type { CategoryScore, LoopScoreInput } from "../types.ts";

export function scoreVerification(input: LoopScoreInput): CategoryScore {
  const checks = input.checks ?? [];
  const evidence: string[] = [];
  const gaps: string[] = [];
  let score = 0;
  const passed = checks.filter((check) => check.status === "passed" && checkHasCommandEvidence(check));
  const failedRequired = failedRequiredChecks(input);

  if (passed.length > 0) {
    score += Math.min(6, 2 + passed.length * 2);
    evidence.push(`${passed.length} concrete verification check(s) passed.`);
  } else {
    gaps.push("No passing verification check with command and evidence was provided.");
  }

  if (checks.some((check) => check.status === "passed" && check.kind === "test" && checkHasCommandEvidence(check))) score += 2;
  else gaps.push("No passed test check was provided.");

  if (checks.some((check) => check.status === "passed" && check.kind !== "test" && check.kind !== "review" && checkHasCommandEvidence(check))) score += 2;
  else gaps.push("No non-test gate such as typecheck, lint, build, or security check was provided.");

  if (failedRequired.length === 0) score += 2;
  else gaps.push(`${failedRequired.length} unresolved required verification check(s) failed.`);

  if (nonEmpty(input.tests?.commandEvidence)) evidence.push("Free-form test command evidence was included as supporting context.");

  return buildCategory("verification", score, evidence, gaps);
}
