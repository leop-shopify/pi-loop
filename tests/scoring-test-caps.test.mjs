import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("mocking status must be explicitly clean", () => {
  const result = scoreLoopResult({
    ...strongInput,
    tests: { ...strongInput.tests, usesMocksForOwnedCode: undefined, mockOnly: undefined },
  });

  assert.ok(result.score <= 85);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("Mocking status")));
});

test("implementation-coupled tests cap at 75", () => {
  const result = scoreLoopResult({
    ...strongInput,
    tests: { ...strongInput.tests, implementationCoupled: true },
  });

  assert.ok(result.score <= 75);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("implementation details")));
});

test("mock-only tests cap the score at 50", () => {
  const result = scoreLoopResult({
    ...strongInput,
    tests: { ...strongInput.tests, mockOnly: true },
  });

  assert.ok(result.score <= 50);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("mock-only")));
});

test("owned-code mocks prevent a high score", () => {
  const result = scoreLoopResult({
    ...strongInput,
    tests: { ...strongInput.tests, usesMocksForOwnedCode: true },
  });

  assert.ok(result.score <= 75);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("owned code")));
});
