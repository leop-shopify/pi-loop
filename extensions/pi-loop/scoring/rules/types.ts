import type { Cap, LoopScoreInput } from "../types.ts";

export interface ScoringRule {
  name: string;
  evaluate(input: LoopScoreInput): Cap[];
}
