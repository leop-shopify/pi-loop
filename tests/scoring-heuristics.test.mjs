import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("strong first evidence is a baseline, not a completed loop", () => {
  const result = scoreLoopResult(strongInput);

  assert.equal(result.passedDefinition, false);
  assert.ok(result.score >= 90);
  assert.equal(result.improvement, null);
  assert.equal(result.outcome, "needs_iteration");
  assert.match(result.nextActions[0], /baseline/i);
  assert.deepEqual(result.verifierFindings, []);
});

test("positive progress over the prior best records a successful improvement", () => {
  const result = scoreLoopResult({ ...strongInput, previousScore: 82, bestScore: 82, baselineScore: 82 });

  assert.equal(result.improvement, result.score - 82);
  assert.equal(result.progressPercent, 22);
  assert.equal(result.passedDefinition, true);
  assert.equal(result.outcome, "successful_improvement");
});

test("repeating the same positive progress does not satisfy the loop", () => {
  const first = scoreLoopResult({ ...strongInput, previousScore: 82, bestScore: 82, baselineScore: 82 });
  const repeated = scoreLoopResult({ ...strongInput, previousScore: first.score, bestScore: first.score, baselineScore: 82 });

  assert.equal(repeated.improvement, 0);
  assert.equal(repeated.progressPercent, first.progressPercent);
  assert.equal(repeated.passedDefinition, false);
  assert.equal(repeated.outcome, "needs_iteration");
  assert.match(repeated.nextActions[0], /did not beat the best prior score/);
});

test("reusing the prior plan cannot count as successful improvement", () => {
  const result = scoreLoopResult({ ...strongInput, attempt: { ...strongInput.attempt, reusedPriorPlan: true }, previousScore: 82, bestScore: 82, baselineScore: 82 });

  assert.equal(result.score > 82, true);
  assert.equal(result.passedDefinition, false);
  assert.equal(result.outcome, "needs_iteration");
  assert.match(result.nextActions[0], /Change strategy/);
});

test("repeating a prior fullPlan is detected even without self-reporting reuse", () => {
  const result = scoreLoopResult({ ...strongInput, priorAttemptPlans: [strongInput.attempt.fullPlan], previousScore: 82, bestScore: 82, baselineScore: 82 });

  assert.equal(result.score, 85);
  assert.equal(result.passedDefinition, false);
  assert.equal(result.outcome, "needs_iteration");
  assert.match(result.blockers[0].message, /fullPlan repeats/);
  assert.match(result.nextActions[0], /current plan repeats a prior attempt/);
});

test("zero progress reports a plateau instead of chasing baseline improvement", () => {
  const result = scoreLoopResult({ ...strongInput, previousScore: 100, bestScore: 100, baselineScore: 100 });

  assert.equal(result.progressPercent, 0);
  assert.equal(result.passedDefinition, false);
  assert.equal(result.outcome, "needs_iteration");
  assert.match(result.nextActions[0], /Score plateaued at the baseline/);
});

test("absolute target score is not the completion cutoff", () => {
  const result = scoreLoopResult({ ...strongInput, previousScore: 100, baselineScore: 100, targetScore: 1 });

  assert.equal(result.passedDefinition, false);
  assert.equal(result.outcome, "needs_iteration");
  assert.match(result.nextActions[0], /Score plateaued at the baseline/);
});

test("docs-only change does not require review gates", () => {
  const result = scoreLoopResult({
    ...strongInput,
    artifacts: [{ path: "README.md", purpose: "documentation", kind: "docs" }],
    checks: [],
    tests: undefined,
    rails: { relevant: false },
    reviewGates: [],
  });

  assert.ok(result.categories.some((category) => category.key === "reviewGates" && category.score === category.max));
});
