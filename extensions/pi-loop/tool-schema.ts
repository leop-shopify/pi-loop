import { Type } from "@sinclair/typebox";

const StatusSchema = Type.Union([Type.Literal("met"), Type.Literal("partial"), Type.Literal("missing"), Type.Literal("unknown")]);
const CheckStatusSchema = Type.Union([Type.Literal("passed"), Type.Literal("failed"), Type.Literal("not_run"), Type.Literal("unknown")]);
const CheckKindSchema = Type.Union([Type.Literal("test"), Type.Literal("typecheck"), Type.Literal("lint"), Type.Literal("format"), Type.Literal("build"), Type.Literal("coverage"), Type.Literal("security"), Type.Literal("dependency"), Type.Literal("dependency_audit"), Type.Literal("migration_safety"), Type.Literal("ci"), Type.Literal("review")]);
const ArtifactKindSchema = Type.Union([Type.Literal("source"), Type.Literal("test"), Type.Literal("migration"), Type.Literal("config"), Type.Literal("docs"), Type.Literal("generated"), Type.Literal("script")]);
const RiskKindSchema = Type.Union([Type.Literal("correctness"), Type.Literal("security"), Type.Literal("authorization"), Type.Literal("data_integrity"), Type.Literal("performance"), Type.Literal("maintainability"), Type.Literal("operability")]);
const RiskSeveritySchema = Type.Union([Type.Literal("blocker"), Type.Literal("important"), Type.Literal("minor")]);
const ScopeSchema = Type.Union([Type.Literal("targeted"), Type.Literal("full"), Type.Literal("ci")]);
const StopIntentSchema = Type.Union([Type.Literal("continue"), Type.Literal("claim_done"), Type.Literal("blocked")]);

const AttemptEvidenceSchema = Type.Object({
  rationale: Type.String(),
  fullPlan: Type.String(),
  actionsTaken: Type.Optional(Type.Array(Type.String())),
  stopIntent: Type.Optional(StopIntentSchema),
  reusedPriorPlan: Type.Optional(Type.Boolean()),
});

const RequirementEvidenceSchema = Type.Object({
  id: Type.Optional(Type.String()),
  description: Type.String(),
  status: StatusSchema,
  critical: Type.Optional(Type.Boolean()),
  evidence: Type.Optional(Type.String()),
});

const ArtifactEvidenceSchema = Type.Object({
  path: Type.String(),
  purpose: Type.String(),
  evidence: Type.Optional(Type.String()),
  kind: Type.Optional(ArtifactKindSchema),
});

const CheckEvidenceSchema = Type.Object({
  name: Type.String(),
  status: CheckStatusSchema,
  kind: Type.Optional(CheckKindSchema),
  required: Type.Optional(Type.Boolean()),
  scope: Type.Optional(ScopeSchema),
  command: Type.Optional(Type.String()),
  exitCode: Type.Optional(Type.Number()),
  url: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.String()),
  resolved: Type.Optional(Type.Boolean()),
});

const ReviewGateEvidenceSchema = Type.Object({
  name: Type.String(),
  status: CheckStatusSchema,
  kind: Type.Optional(CheckKindSchema),
  required: Type.Optional(Type.Boolean()),
  scope: Type.Optional(ScopeSchema),
  command: Type.Optional(Type.String()),
  exitCode: Type.Optional(Type.Number()),
  url: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.String()),
  resolved: Type.Optional(Type.Boolean()),
  blocksMerge: Type.Optional(Type.Boolean()),
});

const TestEvidenceSchema = Type.Object({
  files: Type.Optional(Type.Array(Type.String())),
  behaviorsCovered: Type.Optional(Type.Array(Type.String())),
  regressionCovered: Type.Optional(Type.Boolean()),
  edgeCasesCovered: Type.Optional(Type.Array(Type.String())),
  failurePathsCovered: Type.Optional(Type.Array(Type.String())),
  observableAssertions: Type.Optional(Type.Boolean()),
  assertionsExerciseBehavior: Type.Optional(Type.Boolean()),
  wouldFailOnBug: Type.Optional(Type.Boolean()),
  changedCodeCovered: Type.Optional(Type.Boolean()),
  integrationOrSystemCovered: Type.Optional(Type.Boolean()),
  integrationOrContractCovered: Type.Optional(Type.Boolean()),
  usesMocksForOwnedCode: Type.Optional(Type.Boolean()),
  mockOnly: Type.Optional(Type.Boolean()),
  usesFakesForExternalDeps: Type.Optional(Type.Boolean()),
  mockingEvidence: Type.Optional(Type.String()),
  hasSleeps: Type.Optional(Type.Boolean()),
  flaky: Type.Optional(Type.Boolean()),
  implementationCoupled: Type.Optional(Type.Boolean()),
  externalMocksHaveContractTests: Type.Optional(Type.Boolean()),
  coverageEvidence: Type.Optional(Type.String()),
  commandEvidence: Type.Optional(Type.String()),
});

const DesignEvidenceSchema = Type.Object({
  responsibilitiesSplit: Type.Optional(Type.Boolean()),
  smallFiles: Type.Optional(Type.Boolean()),
  solid: Type.Optional(Type.Boolean()),
  noGodFiles: Type.Optional(Type.Boolean()),
  boundariesClear: Type.Optional(Type.Boolean()),
  lowCoupling: Type.Optional(Type.Boolean()),
  encapsulation: Type.Optional(Type.Boolean()),
  complexityManaged: Type.Optional(Type.Boolean()),
  dependenciesSimple: Type.Optional(Type.Boolean()),
  singleResponsibility: Type.Optional(Type.Boolean()),
  lowCouplingHighCohesion: Type.Optional(Type.Boolean()),
  dependencyDirectionClear: Type.Optional(Type.Boolean()),
  complexityControlled: Type.Optional(Type.Boolean()),
  duplicationAvoided: Type.Optional(Type.Boolean()),
  minimalPublicSurface: Type.Optional(Type.Boolean()),
  evidence: Type.Optional(Type.String()),
});

const RailsEvidenceSchema = Type.Object({
  relevant: Type.Optional(Type.Boolean()),
  activeRecordBoundaries: Type.Optional(Type.Boolean()),
  transactionsSafe: Type.Optional(Type.Boolean()),
  callbacksIntentional: Type.Optional(Type.Boolean()),
  migrationsSafe: Type.Optional(Type.Boolean()),
  backgroundJobsSafe: Type.Optional(Type.Boolean()),
  authorizationOrTenancyCovered: Type.Optional(Type.Boolean()),
  queryPerformanceConsidered: Type.Optional(Type.Boolean()),
  inputValidationOrStrongParamsCovered: Type.Optional(Type.Boolean()),
  dbConstraintsOrValidations: Type.Optional(Type.Boolean()),
  sideEffectsAfterCommit: Type.Optional(Type.Boolean()),
  backgroundJobsIdempotent: Type.Optional(Type.Boolean()),
  nPlusOneAvoided: Type.Optional(Type.Boolean()),
  safeDataBackfill: Type.Optional(Type.Boolean()),
  multiDbTransactionsConsidered: Type.Optional(Type.Boolean()),
  dataConstraintsCovered: Type.Optional(Type.Boolean()),
  migrationChanged: Type.Optional(Type.Boolean()),
  authorizationRelevant: Type.Optional(Type.Boolean()),
  nPlusOneGuarded: Type.Optional(Type.Boolean()),
  jobsIdempotent: Type.Optional(Type.Boolean()),
  externalSideEffectsAfterCommit: Type.Optional(Type.Boolean()),
  strongParametersOrInputSafety: Type.Optional(Type.Boolean()),
  evidence: Type.Optional(Type.String()),
});

const ProcessEvidenceSchema = Type.Object({
  inspected: Type.Optional(Type.Array(Type.String())),
  commandsRun: Type.Optional(Type.Array(Type.String())),
  failuresEncountered: Type.Optional(Type.Array(Type.String())),
  fixesApplied: Type.Optional(Type.Array(Type.String())),
  finalOutcome: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.String()),
});

const OperabilityEvidenceSchema = Type.Object({
  limitsDefined: Type.Optional(Type.Boolean()),
  persistenceDefined: Type.Optional(Type.Boolean()),
  loggingAvailable: Type.Optional(Type.Boolean()),
  rollbackOrRecoveryDefined: Type.Optional(Type.Boolean()),
  humanStopAvailable: Type.Optional(Type.Boolean()),
  evidence: Type.Optional(Type.String()),
});

const RiskEvidenceSchema = Type.Object({
  severity: RiskSeveritySchema,
  description: Type.String(),
  evidence: Type.Optional(Type.String()),
  resolved: Type.Optional(Type.Boolean()),
  kind: Type.Optional(RiskKindSchema),
});

export const ScoreLoopParams = Type.Object({
  summary: Type.String({ description: "What changed or was investigated in this loop turn." }),
  artifacts: Type.Optional(Type.Array(ArtifactEvidenceSchema)),
  requirements: Type.Optional(Type.Array(RequirementEvidenceSchema)),
  checks: Type.Optional(Type.Array(CheckEvidenceSchema)),
  tests: Type.Optional(TestEvidenceSchema),
  design: Type.Optional(DesignEvidenceSchema),
  rails: Type.Optional(RailsEvidenceSchema),
  process: Type.Optional(ProcessEvidenceSchema),
  operability: Type.Optional(OperabilityEvidenceSchema),
  reviewGates: Type.Optional(Type.Array(ReviewGateEvidenceSchema)),
  risks: Type.Optional(Type.Array(RiskEvidenceSchema)),
  attempt: Type.Optional(AttemptEvidenceSchema),
});
