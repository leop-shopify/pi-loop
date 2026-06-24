import { AUTH_PATH, JOB_PATH, MIGRATION_PATH, QUERY_PATH, hasArtifactMatching, hasRailsArtifacts } from "../evidence.ts";
import type { Cap, LoopScoreInput } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const railsSafetyRule: ScoringRule = {
  name: "rails-safety",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    const rails = input.rails;

    if (hasRailsArtifacts(input) && rails?.relevant === false) caps.push({ value: 75, reason: "Rails artifacts were touched while Rails evidence was marked irrelevant." });
    if (hasArtifactMatching(input, AUTH_PATH) && rails?.authorizationOrTenancyCovered !== true) caps.push({ value: 70, reason: "Rails authorization or tenancy path changed without evidence." });
    if (rails?.relevant && rails.authorizationRelevant && rails.authorizationOrTenancyCovered !== true) caps.push({ value: 70, reason: "Authorization or tenancy evidence is missing for a relevant Rails change." });
    if (hasArtifactMatching(input, MIGRATION_PATH) && rails?.migrationsSafe !== true && rails?.safeDataBackfill !== true) caps.push({ value: 65, reason: "Rails migration or backfill safety was not proven." });
    if (rails?.relevant && rails.migrationChanged && rails.migrationsSafe !== true && rails.safeDataBackfill !== true) caps.push({ value: 65, reason: "Rails migration or backfill safety was not proven." });
    if (hasArtifactMatching(input, JOB_PATH) && rails?.jobsIdempotent !== true && rails?.backgroundJobsIdempotent !== true && rails?.backgroundJobsSafe !== true) caps.push({ value: 80, reason: "Background job changed without idempotency or retry safety evidence." });
    if (hasArtifactMatching(input, QUERY_PATH) && rails?.queryPerformanceConsidered !== true && rails?.nPlusOneAvoided !== true && rails?.nPlusOneGuarded !== true) caps.push({ value: 80, reason: "Rails query path changed without N+1 or query-performance evidence." });

    return caps;
  },
};
