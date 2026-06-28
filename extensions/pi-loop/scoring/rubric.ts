import type { CategoryKey } from "./types.ts";

export const DEFAULT_TARGET_SCORE = 90;

export const CATEGORY_MAX = {
  correctness: 20,
  testing: 20,
  design: 18,
  rails: 15,
  verification: 12,
  reviewGates: 10,
  operability: 5,
} as const satisfies Record<CategoryKey, number>;

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  correctness: "Correctness",
  testing: "Testing quality",
  design: "Design and SOLID",
  rails: "Rails engineering",
  verification: "Verification and gates",
  reviewGates: "Automated review gates",
  operability: "Operational hardening",
};

export const SCORING_HEURISTICS = {
  targetScore: DEFAULT_TARGET_SCORE,
  categories: CATEGORY_MAX,
  hardRules: [
    "No explicit requirements or acceptance criteria caps the score at 85.",
    "Missing requirements cap the score at 75.",
    "No changed or inspected artifacts caps the score at 85.",
    "No concrete passed test or coverage command for executable code caps the score at 65.",
    "No concrete passed command for non-doc code caps the score at 65.",
    "Free-form test command evidence without a passed check does not satisfy verification.",
    "Mock-only tests cap the score at 50.",
    "Mocks or stubs for owned code cap the score at 75.",
    "Unstated mocking status caps the score at 85.",
    "Failed required verification caps the score at 70 unless marked resolved.",
    "Failed required review gates cap the score at 65.",
    "Failed security, dependency, authorization, or migration-safety gates cap lower than normal failures.",
    "Executable behavior changes without meaningful tests cap the score at 70 unless explicitly justified.",
    "Implementation-coupled or change-detector tests cap the score at 75.",
    "Reusing the prior attempt plan without novel evidence cannot count as a useful improvement.",
    "Unsafe Rails migrations or backfills cap the score at 65.",
    "Unresolved security, authorization, tenancy, or data-integrity risks cap the score at 50.",
    "Unresolved correctness, security, data integrity, or authorization blockers cap the score at 60.",
    "Non-trivial executable changes without CI, required, or merge-blocking review gate evidence cap the score at 85.",
    "Missing no-god-file, single-responsibility, or boundary evidence for production changes caps the score at 85.",
    "A loop, job, or runtime implementation without explicit time and turn limits caps the score at 70.",
    "Contradictory status and exit-code evidence caps high scores.",
    "The internal evidence measurement must never be used as the stop cutoff by itself.",
    "The first feedback attempt is a baseline and cannot stop the loop.",
    "Score improvements are observations, not stop conditions; the loop stops on configured limits, user stop, or repeated missing feedback calls."
  ],
  requiredEvidence: [
    "explicit requirements or acceptance criteria",
    "changed artifacts or inspected paths",
    "passed test or coverage command output with exact command, scope, status, evidence, and successful exit status",
    "passed typecheck, lint, build, security, or equivalent command output with exact command, scope, status, evidence, and successful exit status",
    "CI, required, or merge-blocking automated review gate status for non-trivial executable changes",
    "test quality statement covering behavior assertions, changed-code coverage, over-mocking, sleeps/flakes, and implementation coupling",
    "design responsibility split and coupling evidence",
    "Rails safety evidence when Rails code is relevant",
    "Rails authorization/tenancy and migration safety evidence when relevant",
    "operational limits, persistence, logging, rollback/recovery, and human stop behavior when applicable",
  ],
} as const;

export function scoringRubricSummary(): string {
  return [
    "Loop progress is shown as percent improvement over the first feedback turn; internal measurements are not the user-facing result.",
    "Loop stop rule: loop_feedback provides a tiny checkpoint only; the loop keeps exploring until configured time/turn/run limits, user stop, or repeated missing feedback calls.",
    "Internal evidence categories: correctness, testing quality, design/SOLID, framework-specific/Rails engineering when relevant, verification/gates, automated review gates, and operability.",
    "Tests must assert externally visible behavior and cover the changed code or target bug.",
    "Mocking owned code, mock-only tests, implementation-coupled tests, and flaky sleep-based tests block high scores.",
    "Verification should appear in normal tool history as passed test or coverage commands with successful exit status for executable changes.",
    "Non-trivial executable changes need CI, required, or merge-blocking review gate evidence from normal checks, such as required status checks, quality gates, security scanning, or dependency audit results.",
    "Rails work must prove ActiveRecord boundaries, transaction/callback safety, strong params/input validation, DB constraints, migration/backfill safety, authorization or tenancy, job idempotency, and query performance during normal work or final refinement where relevant.",
  ].join("\n");
}
