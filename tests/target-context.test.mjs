import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseLoopArgs } from "../extensions/pi-loop/commands.ts";
import { buildTargetContextSnapshot, formatTargetContext } from "../extensions/pi-loop/target-context.ts";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-target-"));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("quote-aware args parse explicit files, symbols, checks, and runs", () => {
  const parsed = parseLoopArgs("Improve `CartCalculator` --file=src/cart.ts --symbol=CartCalculator --check=\"pnpm test tests/cart.test.mjs\" --runs=5 --turns=30");

  assert.equal(parsed.goal, "Improve `CartCalculator`");
  assert.deepEqual(parsed.files, ["src/cart.ts"]);
  assert.deepEqual(parsed.symbols, ["CartCalculator"]);
  assert.deepEqual(parsed.checks, ["pnpm test tests/cart.test.mjs"]);
  assert.equal(parsed.runs, 5);
  assert.equal(parsed.turns, 30);
});

test("target context normalizes explicit paths, symbols, and package-script checks", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { check: "pnpm test && pnpm typecheck", test: "node --test", build: "tsc" } }));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(dir, "source.ts"), "export {};\n");

    const snapshot = buildTargetContextSnapshot({ cwd: dir, goal: "Improve source.ts and `Thing`", files: ["./source.ts", "../escape.ts"], symbols: ["Explicit"], checks: ["pnpm lint"] });

    assert.deepEqual(snapshot.files.map((file) => file.path), ["source.ts"]);
    assert.deepEqual(snapshot.symbols.map((symbol) => symbol.name).sort(), ["Explicit", "Thing"]);
    assert.ok(snapshot.checks.some((check) => check.command === "pnpm lint"));
    assert.ok(snapshot.checks.some((check) => check.command === "pnpm test"));
    assert.match(formatTargetContext(snapshot), /files: source.ts/);
  });
});
