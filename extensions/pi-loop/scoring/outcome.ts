import type { LoopScoreInput, LoopScoreResult } from "./types.ts";
import type { EvidenceVerificationFinding } from "./verification-finding.ts";

export type LoopFeedbackOutcome = "invalid_evidence" | "verification_failed" | "review_gate_failed" | "safety_blocked" | "tool_or_runtime_failure" | "successful_improvement" | "successful_no_improvement" | "needs_iteration";

export function classifyOutcome(input: LoopScoreInput, result: Omit<LoopScoreResult, "outcome">, findings: readonly EvidenceVerificationFinding[]): LoopFeedbackOutcome {
  if (findings.some((finding) => finding.severity === "blocker")) return "invalid_evidence";
  if ((input.checks ?? []).some((check) => check.status === "failed" && !check.resolved)) return "verification_failed";
  if ((input.reviewGates ?? []).some((gate) => gate.status === "failed" && !gate.resolved && (gate.required || gate.blocksMerge))) return "review_gate_failed";
  if ((input.risks ?? []).some((risk) => !risk.resolved && (risk.severity === "blocker" || risk.kind === "security" || risk.kind === "authorization" || risk.kind === "data_integrity"))) return "safety_blocked";
  if (result.blockers.some((blocker) => blocker.severity === "blocker")) return "safety_blocked";
  if (!result.passedDefinition) return "needs_iteration";
  return (result.improvement ?? 0) > 0 ? "successful_improvement" : "successful_no_improvement";
}
