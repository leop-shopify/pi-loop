export type AttemptStopIntent = "continue" | "claim_done" | "blocked";

export interface AttemptEvidence {
  rationale: string;
  fullPlan: string;
  actionsTaken?: string[];
  stopIntent?: AttemptStopIntent;
  reusedPriorPlan?: boolean;
}
