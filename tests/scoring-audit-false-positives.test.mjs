import assert from "node:assert/strict";
import { test } from "node:test";

import { Value } from "typebox/value";
import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { ScoreLoopParams } from "../extensions/pi-loop/tool-schema.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("runtime schema rejects invalid enum values", () => {
  const invalidCases = [
    { summary: "x", requirements: [{ description: "r", status: "done" }] },
    { summary: "x", checks: [{ name: "tests", status: "green", kind: "test" }] },
    { summary: "x", checks: [{ name: "tests", status: "passed", kind: "unit" }] },
    { summary: "x", checks: [{ name: "tests", status: "passed", scope: "local" }] },
    { summary: "x", artifacts: [{ path: "bin/tool", purpose: "tool", kind: "binary" }] },
    { summary: "x", risks: [{ severity: "severe", description: "risk" }] },
    { summary: "x", attempt: { rationale: "r", fullPlan: "p", stopIntent: "done" } },
    { summary: "x", risks: [{ severity: "minor", kind: "bug", description: "risk" }] },
  ];

  for (const params of invalidCases) assert.equal(Value.Check(ScoreLoopParams, params), false);
  assert.equal(Value.Check(ScoreLoopParams, { summary: "x", checks: [{ name: "tests", status: "passed", kind: "test", scope: "targeted" }], attempt: { rationale: "r", fullPlan: "p", stopIntent: "claim_done" } }), true);
});

test("executable changes require a passed test or coverage command", () => {
  const result = scoreLoopResult({
    ...strongInput,
    checks: [{ name: "typecheck", status: "passed", kind: "typecheck", required: true, command: "pnpm typecheck", exitCode: 0, evidence: "no type errors" }],
  });

  assertCap(result, 65, "No concrete passed test or coverage command");
});

test("optional local review gates alone cannot pass executable changes", () => {
  const result = scoreLoopResult({
    ...strongInput,
    reviewGates: [{ name: "local quality", status: "passed", kind: "review", command: "pnpm lint", exitCode: 0, evidence: "local advisory lint passed" }],
  });

  assertCap(result, 85, "lacks passed CI, required, or merge-blocking review gate");
});

test("review gates marked passed reject non-zero exit codes", () => {
  const result = scoreLoopResult({
    ...strongInput,
    reviewGates: [
      { name: "ci", status: "passed", kind: "ci", required: true, blocksMerge: true, scope: "ci", command: "pnpm check", exitCode: 1, evidence: "CI command failed" },
      ...strongInput.reviewGates.slice(1),
    ],
  });

  assertCap(result, 65, "Review gate ci is marked passed but has non-zero exit code 1");
});

test("Rails safety caps fire without structured Rails evidence", () => {
  const result = scoreLoopResult({
    ...strongInput,
    artifacts: [{ path: "db/migrate/20260624000000_backfill_orders.rb", purpose: "backfill", kind: "migration" }],
    rails: undefined,
  });

  assertCap(result, 65, "Rails migration or backfill safety");
});

test("broader Rails path detection catches GraphQL authorization paths", () => {
  const result = scoreLoopResult({
    ...strongInput,
    artifacts: [{ path: "app/graphql/mutations/update_order.rb", purpose: "mutation", kind: "source" }],
    rails: { relevant: false },
  });

  assertCap(result, 75, "Rails artifacts were touched");
});

test("production changes cannot omit structured attempt evidence", () => {
  for (const attempt of [undefined, { fullPlan: "plan" }, { rationale: "why" }]) {
    const result = scoreLoopResult({ ...strongInput, attempt });
    assertCap(result, 85, "missing");
  }
});

test("production changes cannot omit core design and SOLID evidence", () => {
  for (const design of [
    { ...strongInput.design, noGodFiles: undefined },
    { ...strongInput.design, singleResponsibility: undefined, responsibilitiesSplit: undefined },
    { ...strongInput.design, boundariesClear: undefined },
  ]) {
    const result = scoreLoopResult({ ...strongInput, design });
    assertCap(result, 85, "missing no-god-file, single-responsibility, or boundary evidence");
  }
});

test("operability relevance uses goal and artifact paths", () => {
  const result = scoreLoopResult({
    ...strongInput,
    goal: "Add auto-resume persistence",
    summary: "Changed the storage module.",
    artifacts: [{ path: "extensions/pi-loop/runtime-store.ts", purpose: "runtime state", kind: "source" }],
    operability: { ...strongInput.operability, limitsDefined: undefined },
  });

  assertCap(result, 70, "without explicit limits");
});

test("contradictory passed checks with non-zero exits cap the score", () => {
  const result = scoreLoopResult({
    ...strongInput,
    checks: [{ name: "tests", status: "passed", kind: "test", required: true, command: "pnpm test", exitCode: 1, evidence: "test command failed" }],
  });

  assertCap(result, 65, "Check tests is marked passed but has non-zero exit code 1");
});

function assertCap(result, maxScore, message) {
  assert.ok(result.score <= maxScore, `expected score <= ${maxScore}, got ${result.score}`);
  assert.equal(result.passedDefinition, false);
  assert.ok(result.blockers.some((blocker) => blocker.message.includes(message)), result.blockers.map((blocker) => blocker.message).join("\n"));
}
