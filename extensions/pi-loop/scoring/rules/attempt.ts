import { hasProductionArtifacts } from "../evidence.ts";
import type { Cap, LoopScoreInput } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const attemptRule: ScoringRule = {
  name: "attempt",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    if (!hasProductionArtifacts(input)) return caps;

    if (!input.attempt?.rationale?.trim()) caps.push({ value: 85, reason: "Production change is missing a visible attempt rationale." });
    if (!input.attempt?.fullPlan?.trim()) caps.push({ value: 85, reason: "Production change is missing a structured current plan." });
    if (input.attempt?.reusedPriorPlan === true) caps.push({ value: 85, reason: "Attempt reused a prior plan without novel evidence." });

    return caps;
  },
};
