import type { AttemptEvidence } from "./attempt.ts";
import type { LoopFeedbackOutcome } from "./outcome.ts";
import type { EvidenceVerificationFinding } from "./verification-finding.ts";

export type CheckStatus = "passed" | "failed" | "not_run" | "unknown";
export type CheckKind = "test" | "typecheck" | "lint" | "format" | "build" | "coverage" | "security" | "dependency" | "dependency_audit" | "migration_safety" | "ci" | "review";
export type ArtifactKind = "source" | "test" | "migration" | "config" | "docs" | "generated" | "script";
export type RiskKind = "correctness" | "security" | "authorization" | "data_integrity" | "performance" | "maintainability" | "operability";
export type RiskSeverity = "blocker" | "important" | "minor";
export type CategoryKey = "correctness" | "testing" | "design" | "rails" | "verification" | "reviewGates" | "operability";

export interface RequirementEvidence {
  id?: string;
  description: string;
  status: "met" | "partial" | "missing" | "unknown";
  critical?: boolean;
  evidence?: string;
}

export interface ArtifactEvidence {
  path: string;
  purpose: string;
  evidence?: string;
  kind?: ArtifactKind;
}

export interface CheckEvidence {
  name: string;
  status: CheckStatus;
  kind?: CheckKind;
  required?: boolean;
  scope?: "targeted" | "full" | "ci";
  command?: string;
  exitCode?: number;
  url?: string;
  evidence?: string;
  resolved?: boolean;
}

export interface ReviewGateEvidence extends CheckEvidence {
  blocksMerge?: boolean;
}

export interface TestEvidence {
  files?: string[];
  behaviorsCovered?: string[];
  regressionCovered?: boolean;
  edgeCasesCovered?: string[];
  failurePathsCovered?: string[];
  observableAssertions?: boolean;
  assertionsExerciseBehavior?: boolean;
  wouldFailOnBug?: boolean;
  changedCodeCovered?: boolean;
  integrationOrSystemCovered?: boolean;
  integrationOrContractCovered?: boolean;
  usesMocksForOwnedCode?: boolean;
  mockOnly?: boolean;
  usesFakesForExternalDeps?: boolean;
  mockingEvidence?: string;
  hasSleeps?: boolean;
  flaky?: boolean;
  implementationCoupled?: boolean;
  externalMocksHaveContractTests?: boolean;
  coverageEvidence?: string;
  commandEvidence?: string;
}

export interface DesignEvidence {
  responsibilitiesSplit?: boolean;
  smallFiles?: boolean;
  solid?: boolean;
  noGodFiles?: boolean;
  boundariesClear?: boolean;
  lowCoupling?: boolean;
  encapsulation?: boolean;
  complexityManaged?: boolean;
  dependenciesSimple?: boolean;
  singleResponsibility?: boolean;
  lowCouplingHighCohesion?: boolean;
  dependencyDirectionClear?: boolean;
  complexityControlled?: boolean;
  duplicationAvoided?: boolean;
  minimalPublicSurface?: boolean;
  evidence?: string;
}

export interface RailsEvidence {
  relevant?: boolean;
  activeRecordBoundaries?: boolean;
  transactionsSafe?: boolean;
  callbacksIntentional?: boolean;
  migrationsSafe?: boolean;
  backgroundJobsSafe?: boolean;
  authorizationOrTenancyCovered?: boolean;
  queryPerformanceConsidered?: boolean;
  inputValidationOrStrongParamsCovered?: boolean;
  dbConstraintsOrValidations?: boolean;
  sideEffectsAfterCommit?: boolean;
  backgroundJobsIdempotent?: boolean;
  nPlusOneAvoided?: boolean;
  safeDataBackfill?: boolean;
  multiDbTransactionsConsidered?: boolean;
  dataConstraintsCovered?: boolean;
  migrationChanged?: boolean;
  authorizationRelevant?: boolean;
  nPlusOneGuarded?: boolean;
  jobsIdempotent?: boolean;
  externalSideEffectsAfterCommit?: boolean;
  strongParametersOrInputSafety?: boolean;
  evidence?: string;
}

export interface ProcessEvidence {
  inspected?: string[];
  commandsRun?: string[];
  failuresEncountered?: string[];
  fixesApplied?: string[];
  finalOutcome?: string;
  evidence?: string;
}

export interface OperabilityEvidence {
  limitsDefined?: boolean;
  persistenceDefined?: boolean;
  loggingAvailable?: boolean;
  rollbackOrRecoveryDefined?: boolean;
  humanStopAvailable?: boolean;
  evidence?: string;
}

export interface RiskEvidence {
  severity: RiskSeverity;
  description: string;
  evidence?: string;
  resolved?: boolean;
  kind?: RiskKind;
}

export interface LoopScoreInput {
  goal: string;
  summary: string;
  domain?: { softwareProject?: boolean };
  artifacts?: ArtifactEvidence[];
  requirements?: RequirementEvidence[];
  checks?: CheckEvidence[];
  tests?: TestEvidence;
  design?: DesignEvidence;
  rails?: RailsEvidence;
  process?: ProcessEvidence;
  operability?: OperabilityEvidence;
  reviewGates?: ReviewGateEvidence[];
  risks?: RiskEvidence[];
  attempt?: AttemptEvidence;
  previousScore?: number | null;
  bestScore?: number | null;
  priorAttemptPlans?: string[];
  baselineScore?: number | null;
  targetScore?: number;
}

export interface CategoryScore {
  key: CategoryKey;
  label: string;
  score: number;
  max: number;
  evidence: string[];
  gaps: string[];
}

export interface ScoreBlocker {
  severity: RiskSeverity;
  message: string;
  evidence?: string;
}

export interface LoopScoreResult {
  score: number;
  rawScore: number;
  targetScore: number;
  baselineScore: number | null;
  progressPercent: number | null;
  passedDefinition: boolean;
  improvement: number | null;
  categories: CategoryScore[];
  blockers: ScoreBlocker[];
  strengths: string[];
  nextActions: string[];
  outcome: LoopFeedbackOutcome;
  verifierFindings: EvidenceVerificationFinding[];
}

export interface Cap {
  value: number;
  reason: string;
  evidence?: string;
}
