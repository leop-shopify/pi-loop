import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loopHelp, parseLoopArgs } from "../extensions/pi-loop/commands.ts";
import { buildTargetContextSnapshot, formatTargetContext } from "../extensions/pi-loop/target-context.ts";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-target-"));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("loop args default to short capped loops", () => {
  const parsed = parseLoopArgs("Improve scorer --minutes=90");

  assert.equal(parsed.minutes, 10);
  assert.equal(parsed.turns, 12);
  assert.match(loopHelp(), /--minutes=10/);
  assert.match(loopHelp(), /--turns=12/);
  assert.match(loopHelp(), /10 minutes and 12 total attempts/);
});

test("shipped Goal skill advertises only parser-supported bounds", () => {
  const skill = readFileSync(new URL("../skills/pi-goal-writer/SKILL.md", import.meta.url), "utf8");
  assert.doesNotMatch(skill, /--tokens/);
  for (const flag of ["--minutes", "--turns", "--target", "--runs"]) assert.match(skill, new RegExp(flag));
});

test("loop args parse panel visibility commands", () => {
  assert.equal(parseLoopArgs("hide").command, "hide");
  assert.equal(parseLoopArgs("show").command, "show");
  assert.equal(parseLoopArgs("toggle").command, "toggle");
  assert.match(loopHelp(), /\/pi-goal hide \| show \| toggle/);
});

test("quote-aware args parse explicit files, symbols, checks, and runs", () => {
  const parsed = parseLoopArgs("Improve `CartCalculator` --file=src/cart.ts --symbol=CartCalculator --check=\"pnpm test tests/cart.test.mjs\" --runs=5 --turns=30");

  assert.equal(parsed.goal, "Improve `CartCalculator`");
  assert.deepEqual(parsed.files, ["src/cart.ts"]);
  assert.deepEqual(parsed.symbols, ["CartCalculator"]);
  assert.deepEqual(parsed.checks, ["pnpm test tests/cart.test.mjs"]);
  assert.equal(parsed.runs, 5);
  assert.equal(parsed.turns, 12);
});

test("target context falls back to runnable npm package-script commands without a lockfile", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { check: "node --test", lint: "eslint .", test: "node --test", typecheck: "tsc --noEmit" } }));

    const snapshot = buildTargetContextSnapshot({ cwd: dir, goal: "test project" });
    const commands = snapshot.checks.map((check) => check.command).sort();

    assert.equal(snapshot.baseline.packageManager, "unknown");
    assert.deepEqual(commands, ["npm run check", "npm run lint", "npm run typecheck", "npm test"]);
    assert.equal(commands.some((command) => command.startsWith("unknown ")), false);
    assert.equal(commands.includes("npm check"), false);
    assert.equal(commands.includes("npm typecheck"), false);
  });
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
