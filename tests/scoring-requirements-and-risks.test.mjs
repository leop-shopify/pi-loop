import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("missing requirements cap the score", () => {
  const result = scoreLoopResult({
    ...strongInput,
    requirements: [
      { description: "must work", status: "met" },
      { description: "must be safe", status: "missing" },
    ],
  });

  assert.ok(result.score <= 75);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("requirement is missing")));
});

test("critical security risk caps at 50", () => {
  const result = scoreLoopResult({
    ...strongInput,
    risks: [{ severity: "blocker", kind: "security", description: "SQL injection path remains", resolved: false }],
  });

  assert.ok(result.score <= 50);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("SQL injection")));
});
