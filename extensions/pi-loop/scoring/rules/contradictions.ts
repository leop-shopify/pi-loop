import { hasRailsArtifacts } from "../evidence.ts";
import type { Cap, CheckEvidence, LoopScoreInput, ReviewGateEvidence } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const contradictionsRule: ScoringRule = {
  name: "contradictions",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];

    for (const check of input.checks ?? []) addStatusExitContradiction(caps, "Check", check);
    for (const gate of input.reviewGates ?? []) addStatusExitContradiction(caps, "Review gate", gate);
    if (input.tests?.mockOnly === true && input.tests.usesMocksForOwnedCode === false) caps.push({ value: 75, reason: "Test evidence is contradictory: mock-only tests cannot also avoid owned-code mocks." });
    if (hasRailsArtifacts(input) && input.rails?.relevant === false) caps.push({ value: 75, reason: "Evidence is contradictory: Rails paths were changed while Rails relevance was denied." });

    return caps;
  },
};

function addStatusExitContradiction(caps: Cap[], label: string, evidence: CheckEvidence | ReviewGateEvidence): void {
  if (evidence.exitCode === undefined) return;
  if (evidence.status === "passed" && evidence.exitCode !== 0) caps.push({ value: 65, reason: `${label} ${evidence.name} is marked passed but has non-zero exit code ${evidence.exitCode}.`, evidence: evidence.evidence });
  if (evidence.status === "failed" && evidence.exitCode === 0) caps.push({ value: 75, reason: `${label} ${evidence.name} is marked failed but has zero exit code.`, evidence: evidence.evidence });
}
