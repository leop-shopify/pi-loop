export type AttemptStopIntent = "continue" | "claim_done" | "blocked";
export type AcceptanceStatus = "missing" | "discovering" | "proposed" | "confirmed";
export type LoopPlanTaskStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface LoopPlanTaskEvidence {
  id?: string;
  title: string;
  status: LoopPlanTaskStatus;
  evidence?: string;
}

export interface AttemptEvidence {
  rationale: string;
  fullPlan: string;
  actionsTaken?: string[];
  acceptanceStatus?: AcceptanceStatus;
  acceptanceCriteria?: string[];
  planTasks?: LoopPlanTaskEvidence[];
  stopIntent?: AttemptStopIntent;
  reusedPriorPlan?: boolean;
}
