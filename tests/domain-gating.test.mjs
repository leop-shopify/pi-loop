import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";

function nonCodeInput(overrides = {}) {
  return {
    goal: "build me a virtual house",
    summary: "gathered house layout options and confirmed the plan",
    domain: { softwareProject: false },
    artifacts: [],
    requirements: [{ id: "AC1", description: "house has walls, roof, door", status: "partial", evidence: "layout drafted" }],
    checks: [],
    attempt: {
      rationale: "planning",
      fullPlan: "draft layout, confirm, build",
      actionsTaken: ["drafted layout"],
      acceptanceStatus: "confirmed",
      acceptanceCriteria: ["house has walls, roof, door"],
      planTasks: [{ id: "T1", title: "Draft layout", status: "completed" }],
      stopIntent: "continue",
      reusedPriorPlan: false,
    },
    ...overrides,
  };
}

test("non-software goals do not get code-centric review-gate or test blockers", () => {
  const result = scoreLoopResult(nonCodeInput());
  const messages = [...result.blockers.map((blocker) => blocker.message), ...result.verifierFindings.map((finding) => finding.message)].join(" | ");
  assert.doesNotMatch(messages, /review gate/i);
  assert.doesNotMatch(messages, /passed test|coverage command/i);
  assert.doesNotMatch(messages, /Rails/);
});

test("the same empty-artifact input without a domain hint keeps the conservative caps", () => {
  const input = nonCodeInput();
  delete input.domain;
  const result = scoreLoopResult(input);
  const messages = result.blockers.map((blocker) => blocker.message).join(" | ");
  assert.match(messages, /review gate|passed test|coverage|command/i);
});

test("software-domain goals keep the caps even with empty artifacts", () => {
  const result = scoreLoopResult(nonCodeInput({ domain: { softwareProject: true } }));
  const messages = result.blockers.map((blocker) => blocker.message).join(" | ");
  assert.match(messages, /review gate|passed test|coverage|command/i);
});
