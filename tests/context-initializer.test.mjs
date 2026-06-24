import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildLoopContextSnapshot, formatLoopContext } from "../extensions/pi-loop/context.ts";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-context-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("context initializer captures package scripts and bounded prior scores", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test", typecheck: "tsc --noEmit" } }));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

    const snapshot = buildLoopContextSnapshot(dir, "harden loop", [
      { type: "score", turn: 1, timestamp: 1, summary: "x", score: 70, rawScore: 70, targetScore: 90, passedDefinition: false, improvement: null, blockers: [], nextActions: [], categories: [], outcome: "needs_iteration" },
    ]);

    assert.equal(snapshot.goal.raw, "harden loop");
    assert.equal(snapshot.baseline.packageManager, "pnpm");
    assert.deepEqual(snapshot.baseline.scripts, ["test", "typecheck"]);
    assert.deepEqual(snapshot.history.recentScores, [{ score: 70, targetScore: 90, timestamp: 1, summary: "x" }]);
    assert.match(formatLoopContext(snapshot), /scripts: test, typecheck/);
  });
});
