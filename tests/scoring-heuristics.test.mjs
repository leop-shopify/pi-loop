import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("strong evidence passes the definition of done", () => {
  const result = scoreLoopResult(strongInput);

  assert.equal(result.passedDefinition, true);
  assert.ok(result.score >= 90);
  assert.equal(result.blockers.filter((blocker) => blocker.severity === "blocker").length, 0);
  assert.equal(result.outcome, "successful_no_improvement");
  assert.deepEqual(result.verifierFindings, []);
});

test("improvement is calculated against the previous score", () => {
  const result = scoreLoopResult({ ...strongInput, previousScore: 82 });

  assert.equal(result.improvement, result.score - 82);
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
