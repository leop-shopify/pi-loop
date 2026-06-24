import { SECURITY_CHECK_KINDS, failedRequiredChecks, hasConcreteTestOrCoverageVerification, hasConcreteVerification, hasProductionArtifacts } from "../evidence.ts";
import type { Cap, CheckEvidence, LoopScoreInput } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const verificationRule: ScoringRule = {
  name: "verification",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    const productionArtifacts = hasProductionArtifacts(input);

    if (productionArtifacts && !hasConcreteTestOrCoverageVerification(input)) caps.push({ value: 65, reason: "No concrete passed test or coverage command was provided for executable code." });
    if (productionArtifacts && !hasConcreteVerification(input)) caps.push({ value: 65, reason: "No concrete passed command was provided for non-doc code." });
    if (input.tests?.commandEvidence && !hasConcreteVerification(input)) caps.push({ value: 65, reason: "Free-form test command evidence was provided without a passed check entry." });
    for (const check of failedRequiredChecks(input)) caps.push({ value: failedCheckCap(check), reason: `Verification failed: ${check.name}.`, evidence: check.evidence });
    if ((input.checks ?? []).some((check) => check.status === "failed" && !check.resolved && check.kind !== undefined && SECURITY_CHECK_KINDS.has(check.kind))) caps.push({ value: 60, reason: "A security or dependency audit gate failed." });

    return caps;
  },
};

function failedCheckCap(check: CheckEvidence): number {
  if (check.kind === "security" || check.kind === "dependency" || check.kind === "dependency_audit") return 60;
  if (check.kind === "migration_safety") return 65;
  return 70;
}
