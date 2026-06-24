import { buildCategory } from "../category.ts";
import { CATEGORY_MAX } from "../rubric.ts";
import { hasProductionArtifacts, isDocsOnlyChange, nonEmpty } from "../evidence.ts";
import type { CategoryScore, LoopScoreInput, ReviewGateEvidence } from "../types.ts";

export function scoreReviewGates(input: LoopScoreInput): CategoryScore {
  const gates = input.reviewGates ?? [];
  const evidence: string[] = [];
  const gaps: string[] = [];
  let score = 0;

  if (isDocsOnlyChange(input)) return buildCategory("reviewGates", CATEGORY_MAX.reviewGates, ["Docs-only change does not require automated review gates."], gaps);
  if (!hasProductionArtifacts(input)) return buildCategory("reviewGates", CATEGORY_MAX.reviewGates, ["No executable artifacts require automated review gates."], gaps);
  if (gates.length === 0) return buildCategory("reviewGates", 0, evidence, ["No automated review gate evidence was provided for executable changes."]);

  const required = gates.filter((gate) => gate.required || gate.blocksMerge);
  const requiredPassed = required.filter((gate) => gate.status === "passed" && gateHasEvidence(gate));
  const optionalPassed = gates.filter((gate) => !(gate.required || gate.blocksMerge) && gate.status === "passed" && gateHasEvidence(gate));
  const failedRequired = required.filter((gate) => gate.status === "failed" && !gate.resolved);

  if (required.length > 0 && requiredPassed.length === required.length) {
    score += 6;
    evidence.push(`${requiredPassed.length} required review gate(s) passed.`);
  } else if (requiredPassed.length > 0) {
    score += 3;
    gaps.push(`${required.length - requiredPassed.length} required review gate(s) missing or not passed.`);
  } else if (required.length > 0) {
    gaps.push("Required review gates did not pass with evidence.");
  }

  if (gates.some((gate) => gate.status === "passed" && gateHasEvidence(gate) && (gate.kind === "security" || gate.kind === "dependency" || gate.kind === "dependency_audit"))) score += 2;
  else gaps.push("No security or dependency review gate evidence was provided.");

  if (gates.some((gate) => gate.status === "passed" && gateHasEvidence(gate) && (gate.scope === "ci" || gate.kind === "ci" || gate.blocksMerge))) score += 1;
  else gaps.push("No full CI or merge-blocking gate evidence was provided.");

  if (optionalPassed.length > 0) score += 1;
  else if (required.length === 0) gaps.push("Only optional or local review gates were expected, but none passed with evidence.");

  if (failedRequired.length > 0) gaps.push(`${failedRequired.length} required review gate(s) failed.`);

  return buildCategory("reviewGates", score, evidence, gaps);
}

export function gateHasEvidence(gate: ReviewGateEvidence): boolean {
  if (gate.exitCode !== undefined && gate.exitCode !== 0) return false;
  return nonEmpty(gate.evidence) || nonEmpty(gate.url) || nonEmpty(gate.command);
}
