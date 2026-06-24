import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { statusText } from "../extensions/pi-loop/commands.ts";
import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { appendLogEntry, reconstructLoopState } from "../extensions/pi-loop/log.ts";
import {
  createLoopState,
  deadlineReached,
  scoreEntryFromResult,
  startLoopState,
  turnLimitReached,
} from "../extensions/pi-loop/state.ts";
import { improvementText, progressPercent, renderLoopWidget } from "../extensions/pi-loop/ui.ts";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const plainTheme = {
  fg(_color, text) { return text; },
  bold(text) { return text; },
};

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

test("state reconstruction does not share active loops across Pi sessions", () => {
  withTempDir((dir) => {
    const state = createLoopState();
    const config = startLoopState(state, {
      goal: "session scoped loop",
      targetScore: 90,
      maxTurns: 3,
      maxMinutes: 60,
      startedAt: Date.now(),
      sessionId: "session-a",
    });
    const scoreEntry = scoreEntryFromResult(1, "first attempt", minimalScore);

    appendLogEntry(dir, config);
    appendLogEntry(dir, scoreEntry);

    const sameSession = reconstructLoopState(dir, Date.now(), "session-a");
    const otherSession = reconstructLoopState(dir, Date.now(), "session-b");

    assert.equal(sameSession.active, true);
    assert.equal(sameSession.goal, "session scoped loop");
    assert.equal(otherSession.active, false);
    assert.equal(otherSession.goal, null);
    assert.equal(otherSession.results.length, 0);
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

test("loop widget renders a bordered score dashboard with a recent-attempt table", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "improve the dynamic loop interface",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 60,
    startedAt: Date.now() - 123_000,
  });

  for (let turn = 1; turn <= 7; turn++) {
    state.results.push(progressEntry(turn, turn === 1 ? null : turn * 2.5));
  }

  const lines = renderLoopWidget(state, 120, plainTheme);
  const text = lines.join("\n");

  assert.match(lines[0], /pi-loop running/);
  assert.match(text, /Progress:/);
  assert.match(text, /Budget:/);
  assert.match(text, /#\s+run\s+progress\s+state\s+detail/);
  assert.match(text, /\+17\.5%/);
  assert.match(text, /… 1 earlier attempt/);
  assert.match(text, /continue|baseline|accepted|blocked/);
});

test("loop status reports the README runtime steps", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "show runtime steps",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 60,
    startedAt: Date.now(),
  });
  state.totalTurnsStarted = 1;
  state.turnsStarted = 1;

  const text = statusText(state, "/tmp/project");

  assert.match(text, /Runtime steps:/);
  assert.match(text, /01\. done\s+parse config/);
  assert.match(text, /09\. active\s+measure progress/);
  assert.match(text, /12\. done\s+reconstruct/);
});

test("loop widget adapts the table for narrow widths", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "make the loop table responsive at small terminal widths",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 60,
    startedAt: Date.now(),
  });
  state.results.push(progressEntry(1, null));

  const wide = renderLoopWidget(state, 120, plainTheme).join("\n");
  const narrowLines = renderLoopWidget(state, 58, plainTheme);
  const narrow = narrowLines.join("\n");

  assert.match(wide, /#\s+run\s+progress\s+state\s+detail/);
  assert.doesNotMatch(narrow, /corr\s+test|score\s+delta/);
  assert.match(narrow, /#\s+run\s+prog\s+state\s+detail/);
  assert.equal(narrowLines.every((line) => visibleWidth(line) <= 58), true);
});

function progressEntry(turn, progressPercent) {
  const entry = scoreEntryFromResult(turn, `attempt ${turn}`, minimalScore, undefined, 1, turn);
  entry.baselineScore = 64;
  entry.progressPercent = progressPercent;
  entry.passedDefinition = progressPercent !== null && progressPercent > 0;
  return entry;
}
