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

test("positive progress over the first baseline can stop the loop", () => {
  const result = scoreLoopResult({ ...strongInput, previousScore: 82, baselineScore: 82 });

  assert.equal(result.improvement, result.score - 82);
  assert.equal(result.progressPercent, 22);
  assert.equal(result.passedDefinition, true);
  assert.equal(result.outcome, "successful_improvement");
});

test("absolute target score is not the completion cutoff", () => {
  const result = scoreLoopResult({ ...strongInput, previousScore: 100, baselineScore: 100, targetScore: 1 });

  assert.equal(result.passedDefinition, false);
  assert.equal(result.outcome, "needs_iteration");
  assert.match(result.nextActions[0], /baseline attempt/);
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
