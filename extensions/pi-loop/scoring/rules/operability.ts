import { hasProductionArtifacts, operabilityRelevant } from "../evidence.ts";
import type { Cap, LoopScoreInput } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const operabilityRule: ScoringRule = {
  name: "operability",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    if (!hasProductionArtifacts(input) || !operabilityRelevant(input)) return caps;

    const operability = input.operability;
    if (operability?.limitsDefined !== true) caps.push({ value: 70, reason: "Operability-relevant loop, job, or runtime behavior was described without explicit limits." });
    if (operability && (operability.loggingAvailable !== true || operability.rollbackOrRecoveryDefined !== true || operability.humanStopAvailable !== true)) {
      caps.push({ value: 85, reason: "Operability-relevant behavior lacks logging, recovery, or human-stop evidence." });
    }

    return caps;
  },
};
