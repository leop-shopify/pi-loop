import assert from "node:assert/strict";
import { test } from "node:test";

import { RuleRegistry, builtInRules, createDefaultRuleRegistry, scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { attemptRule } from "../extensions/pi-loop/scoring/rules/attempt.ts";
import { contradictionsRule } from "../extensions/pi-loop/scoring/rules/contradictions.ts";
import { designSolidRule } from "../extensions/pi-loop/scoring/rules/design-solid.ts";
import { operabilityRule } from "../extensions/pi-loop/scoring/rules/operability.ts";
import { railsSafetyRule } from "../extensions/pi-loop/scoring/rules/rails-safety.ts";
import { reviewGatesRule } from "../extensions/pi-loop/scoring/rules/review-gates.ts";
import { testQualityRule } from "../extensions/pi-loop/scoring/rules/test-quality.ts";
import { verificationRule } from "../extensions/pi-loop/scoring/rules/verification.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("default rule registry loads external heuristic families", () => {
  const names = createDefaultRuleRegistry().rules().map((rule) => rule.name);

  assert.deepEqual(names, [
    "requirements",
    "attempt",
    "verification",
    "test-quality",
    "review-gates",
    "rails-safety",
    "design-solid",
    "operability",
    "risks",
    "contradictions",
  ]);
  assert.equal(builtInRules.includes(attemptRule), true);
  assert.equal(builtInRules.includes(verificationRule), true);
  assert.equal(builtInRules.includes(reviewGatesRule), true);
  assert.equal(builtInRules.includes(railsSafetyRule), true);
  assert.equal(builtInRules.includes(testQualityRule), true);
  assert.equal(builtInRules.includes(designSolidRule), true);
  assert.equal(builtInRules.includes(operabilityRule), true);
  assert.equal(builtInRules.includes(contradictionsRule), true);
});

test("custom rule registries can be loaded into scoring", () => {
  const registry = new RuleRegistry().load({
    name: "external-cap",
    evaluate: () => [{ value: 42, reason: "External rule cap." }],
  });
  const result = scoreLoopResult(strongInput, registry);

  assert.equal(result.score, 42);
  assert.ok(result.blockers.some((blocker) => blocker.message === "External rule cap."));
});
