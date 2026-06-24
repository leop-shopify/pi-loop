import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { appendLogEntry, reconstructLoopState } from "../extensions/pi-loop/log.ts";
import {
  createLoopState,
  deadlineReached,
  scoreEntryFromResult,
  startLoopState,
  turnLimitReached,
} from "../extensions/pi-loop/state.ts";
import { improvementText, progressPercent } from "../extensions/pi-loop/ui.ts";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const minimalScore = scoreLoopResult({
  goal: "test",
  summary: "turn limit and persisted log state were checked",
  artifacts: [{ path: "x", purpose: "test" }],
  requirements: [{ description: "works", status: "partial" }],
  checks: [{ name: "test", status: "passed", command: "node --test", exitCode: 0, evidence: "ok" }],
  tests: {
    files: ["x.test"],
    behaviorsCovered: ["state"],
    regressionCovered: true,
    edgeCasesCovered: ["empty log"],
    failurePathsCovered: ["bad json"],
    usesMocksForOwnedCode: false,
    mockOnly: false,
    hasSleeps: false,
    commandEvidence: "ok",
  },
  design: { responsibilitiesSplit: true, smallFiles: true, solid: true, noGodFiles: true, boundariesClear: true },
  rails: { relevant: false },
  targetScore: 99,
});

test("state reconstructs config and score entries from the log", () => {
  withTempDir((dir) => {
    const state = createLoopState();
    const config = startLoopState(state, {
      goal: "persist the loop",
      targetScore: 99,
      maxTurns: 3,
      maxMinutes: 60,
      startedAt: Date.now(),
    });
    const scoreEntry = scoreEntryFromResult(1, "first attempt", minimalScore);

    appendLogEntry(dir, config);
    appendLogEntry(dir, scoreEntry);

    const reconstructed = reconstructLoopState(dir);

    assert.equal(reconstructed.goal, "persist the loop");
    assert.equal(reconstructed.targetScore, 99);
    assert.equal(reconstructed.maxTurns, 3);
    assert.equal(reconstructed.results.length, 1);
    assert.equal(reconstructed.results[0].summary, "first attempt");
    assert.equal(reconstructed.active, true);
  });
});

test("state stays inactive after a stop event", () => {
  withTempDir((dir) => {
    const state = createLoopState();
    appendLogEntry(dir, startLoopState(state, {
      goal: "stop loop",
      targetScore: 90,
      maxTurns: 20,
      maxMinutes: 60,
      startedAt: Date.now(),
    }));
    appendLogEntry(dir, { type: "event", event: "stopped", timestamp: Date.now(), reason: "user" });

    const reconstructed = reconstructLoopState(dir);

    assert.equal(reconstructed.active, false);
    assert.equal(reconstructed.stopReason, "user");
  });
});

test("deadline and turn limits are enforced deterministically", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "limits",
    targetScore: 90,
    maxTurns: 2,
    maxMinutes: 1,
    startedAt: Date.now() - 61_000,
  });
  state.turnsStarted = 2;

  assert.equal(deadlineReached(state), true);
  assert.equal(turnLimitReached(state), true);
});

test("progress and improvement helpers format score state", () => {
  assert.equal(progressPercent(null, 90), 0);
  assert.equal(progressPercent(45, 90), 50);
  assert.equal(progressPercent(120, 90), 100);
  assert.equal(improvementText(null), "n/a");
  assert.equal(improvementText(7), "+7");
  assert.equal(improvementText(-3), "-3");
});
