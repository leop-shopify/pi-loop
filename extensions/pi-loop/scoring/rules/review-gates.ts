import { hasProductionArtifacts } from "../evidence.ts";
import type { Cap, LoopScoreInput, ReviewGateEvidence } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const reviewGatesRule: ScoringRule = {
  name: "review-gates",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    if (!hasProductionArtifacts(input)) return caps;

    const gates = input.reviewGates ?? [];
    const failedRequiredGate = gates.find((gate) => (gate.required || gate.blocksMerge) && gate.status === "failed" && !gate.resolved);

    if (gates.length === 0) caps.push({ value: 85, reason: "Non-trivial executable change has no automated review gate evidence." });
    if (gates.length > 0 && !hasCiRequiredOrMergeBlockingGate(gates)) caps.push({ value: 85, reason: "Executable change lacks passed CI, required, or merge-blocking review gate evidence." });
    if (failedRequiredGate) caps.push({ value: 65, reason: `Required review gate failed: ${failedRequiredGate.name}.`, evidence: failedRequiredGate.evidence });

    return caps;
  },
};

export function hasCiRequiredOrMergeBlockingGate(gates: readonly ReviewGateEvidence[]): boolean {
  return gates.some((gate) => gate.status === "passed" && gateHasPassedEvidence(gate) && (gate.required || gate.blocksMerge || gate.scope === "ci" || gate.kind === "ci"));
}

export function gateHasPassedEvidence(gate: ReviewGateEvidence): boolean {
  if (gate.exitCode !== undefined && gate.exitCode !== 0) return false;
  return Boolean(gate.evidence?.trim() || gate.url?.trim() || gate.command?.trim());
}
