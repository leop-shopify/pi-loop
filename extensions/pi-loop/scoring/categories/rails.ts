import { buildCategory } from "../category.ts";
import { CATEGORY_MAX } from "../rubric.ts";
import { boolScore, hasRailsArtifacts, nonEmpty } from "../evidence.ts";
import type { CategoryScore, LoopScoreInput } from "../types.ts";

export function scoreRails(input: LoopScoreInput): CategoryScore {
  const rails = input.rails;
  const evidence: string[] = [];
  const gaps: string[] = [];
  const railsArtifacts = hasRailsArtifacts(input);

  if (rails?.relevant === false && !railsArtifacts) return buildCategory("rails", CATEGORY_MAX.rails, ["Rails engineering is not relevant for this turn."], gaps);
  if (!rails) return buildCategory("rails", railsArtifacts ? 3 : 8, evidence, [railsArtifacts ? "Rails artifacts were touched but Rails evidence was not provided." : "Rails relevance was not stated."]);
  if (rails.relevant === false && railsArtifacts) return buildCategory("rails", 3, evidence, ["Rails artifacts were touched but Rails evidence marked Rails irrelevant."]);

  const dataConstraints = rails.dataConstraintsCovered ?? rails.dbConstraintsOrValidations;
  const sideEffectsAfterCommit = rails.externalSideEffectsAfterCommit ?? rails.sideEffectsAfterCommit ?? rails.callbacksIntentional;
  const jobsIdempotent = rails.jobsIdempotent ?? rails.backgroundJobsIdempotent ?? rails.backgroundJobsSafe;
  const queryEvidence = rails.nPlusOneGuarded ?? rails.nPlusOneAvoided ?? rails.queryPerformanceConsidered;
  const inputSafety = rails.strongParametersOrInputSafety ?? rails.inputValidationOrStrongParamsCovered;

  let score = 0;
  score += boolScore(rails.activeRecordBoundaries, 1);
  score += boolScore(rails.transactionsSafe, 1.5);
  score += boolScore(sideEffectsAfterCommit, 1.5);
  score += boolScore(rails.migrationsSafe || rails.safeDataBackfill, 2);
  score += boolScore(jobsIdempotent, 1.5);
  score += boolScore(rails.authorizationOrTenancyCovered, 2);
  score += boolScore(queryEvidence, 1.5);
  score += boolScore(inputSafety, 1);
  score += boolScore(dataConstraints, 1.5);
  score += boolScore(rails.multiDbTransactionsConsidered, 1);

  if (rails.activeRecordBoundaries) evidence.push("ActiveRecord boundaries are clear.");
  else gaps.push("ActiveRecord boundary evidence is missing.");
  if (rails.transactionsSafe) evidence.push("Transactions are safe.");
  else gaps.push("Transaction safety was not shown.");
  if (sideEffectsAfterCommit) evidence.push("External side effects use after_commit or equivalent safety.");
  if (rails.migrationsSafe || rails.safeDataBackfill) evidence.push("Migration or backfill safety was covered.");
  if (rails.authorizationOrTenancyCovered) evidence.push("Authorization or tenancy was covered.");
  else gaps.push("Authorization or tenancy evidence is missing.");
  if (queryEvidence) evidence.push("N+1 or query performance was considered.");
  else gaps.push("Query performance evidence is missing.");
  if (inputSafety) evidence.push("Strong parameters or input safety were covered.");
  if (dataConstraints) evidence.push("DB constraints or data validations were covered.");
  if (jobsIdempotent) evidence.push("Background job idempotency or retry safety was covered.");
  if (nonEmpty(rails.evidence)) evidence.push(rails.evidence!);

  return buildCategory("rails", score, evidence, gaps);
}
