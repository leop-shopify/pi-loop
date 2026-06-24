import type { RiskSeverity } from "./types.ts";

export interface EvidenceVerificationFinding {
  code: string;
  severity: RiskSeverity;
  message: string;
  evidence?: string;
  cap: number;
}
