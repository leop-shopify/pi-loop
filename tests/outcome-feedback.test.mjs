import assert from "node:assert/strict";
import { test } from "node:test";

import { formatScoreResponse } from "../extensions/pi-loop/score-tool.ts";
import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("outcome taxonomy reports failed verification", () => {
  const result = scoreLoopResult({
    ...strongInput,
    checks: [{ name: "tests", status: "failed", kind: "test", required: true, command: "pnpm test", exitCode: 1, evidence: "failed" }],
  });

  assert.equal(result.outcome, "verification_failed");
});

test("outcome taxonomy reports failed required review gates", () => {
  const result = scoreLoopResult({
    ...strongInput,
    reviewGates: [{ name: "ci", status: "failed", kind: "ci", required: true, blocksMerge: true, scope: "ci", command: "pnpm check", exitCode: 1, evidence: "failed" }],
  });

  assert.equal(result.outcome, "review_gate_failed");
});

test("outcome taxonomy reports successful improvement", () => {
  const result = scoreLoopResult({ ...strongInput, previousScore: 80, bestScore: 80, baselineScore: 80 });

  assert.equal(result.outcome, "successful_improvement");
  assert.ok(result.progressPercent > 0);
});

test("outcome taxonomy reports iteration when there is no verified improvement", () => {
  const result = scoreLoopResult({ ...strongInput, previousScore: 99, bestScore: 100, baselineScore: 100, targetScore: 1 });

  assert.equal(result.outcome, "needs_iteration");
});

test("score tool response rewrites stale baseline-chasing next actions", () => {
  const response = formatScoreResponse({
    blockers: [],
    nextActions: ["Improve over the baseline attempt; current progress is 0.0%."],
    verifierFindings: [],
    progressPercent: 0,
    baselineScore: 100,
    passedDefinition: false,
    outcome: "needs_iteration",
  });

  assert.match(response, /Treat baseline progress as feedback only; choose a materially different next action and score again\./);
  assert.doesNotMatch(response, /Improve over the baseline attempt/);
});
