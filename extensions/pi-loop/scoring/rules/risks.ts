import type { Cap, LoopScoreInput } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const risksRule: ScoringRule = {
  name: "risks",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    const blockerRisk = (input.risks ?? []).find((risk) => !risk.resolved && risk.severity === "blocker");
    const criticalRisk = (input.risks ?? []).find((risk) => !risk.resolved && (risk.kind === "security" || risk.kind === "authorization" || risk.kind === "data_integrity"));

    if (criticalRisk) caps.push({ value: 50, reason: criticalRisk.description, evidence: criticalRisk.evidence });
    if (blockerRisk) caps.push({ value: blockerRisk.kind === "security" || blockerRisk.kind === "authorization" || blockerRisk.kind === "data_integrity" ? 50 : 60, reason: blockerRisk.description, evidence: blockerRisk.evidence });
    if ((input.risks ?? []).some((risk) => !risk.resolved && risk.severity === "important")) caps.push({ value: 85, reason: "An important risk remains unresolved." });

    return caps;
  },
};
