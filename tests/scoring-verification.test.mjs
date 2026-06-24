import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("missing concrete verification caps the score", () => {
  const result = scoreLoopResult({
    ...strongInput,
    checks: [],
    tests: { ...strongInput.tests, commandEvidence: undefined },
  });

  assert.ok(result.score <= 65);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("No concrete passed command")));
});

test("free-form test command evidence alone does not satisfy verification", () => {
  const result = scoreLoopResult({
    ...strongInput,
    checks: [],
    tests: { ...strongInput.tests, commandEvidence: "pnpm test passed" },
  });

  assert.ok(result.score <= 65);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("Free-form test command evidence")));
});

test("failed verification caps score and points to the failing check", () => {
  const result = scoreLoopResult({
    ...strongInput,
    checks: [{ name: "typecheck", status: "failed", kind: "typecheck", required: true, command: "pnpm typecheck", exitCode: 2, evidence: "TS error" }],
  });

  assert.ok(result.score <= 70);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("typecheck")));
});
