import assert from "node:assert/strict";
import { test } from "node:test";

import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("Rails artifacts cannot be marked irrelevant", () => {
  const result = scoreLoopResult({
    ...strongInput,
    artifacts: [{ path: "app/controllers/orders_controller.rb", purpose: "controller change", kind: "source" }],
    rails: { relevant: false },
  });

  assert.ok(result.score <= 75);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("Rails artifacts")));
});

test("unsafe Rails migration caps at 65", () => {
  const result = scoreLoopResult({
    ...strongInput,
    artifacts: [{ path: "db/migrate/20260624000000_add_index.rb", purpose: "migration", kind: "migration" }],
    rails: { relevant: true, migrationChanged: true, migrationsSafe: false },
  });

  assert.ok(result.score <= 65);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("migration or backfill safety")));
});

test("failed required review gate caps at 65", () => {
  const result = scoreLoopResult({
    ...strongInput,
    reviewGates: [{ name: "ci", status: "failed", kind: "ci", required: true, blocksMerge: true, evidence: "CI failed" }],
  });

  assert.ok(result.score <= 65);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("Required review gate failed")));
});

test("missing review gate for executable change caps at 85", () => {
  const result = scoreLoopResult({
    ...strongInput,
    reviewGates: [],
  });

  assert.ok(result.score <= 85);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes("automated review gate")));
});
