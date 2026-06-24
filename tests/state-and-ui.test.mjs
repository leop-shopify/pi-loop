import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { statusText } from "../extensions/pi-loop/commands.ts";
import { floatingPanelOverlayOptions } from "../extensions/pi-loop/floating-panel.ts";
import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { appendLogEntry, reconstructLoopState } from "../extensions/pi-loop/log.ts";
import { runtimeStepRows } from "../extensions/pi-loop/runtime-steps.ts";
import {
  createLoopState,
  deadlineReached,
  scoreEntryFromResult,
  startLoopState,
  turnLimitReached,
} from "../extensions/pi-loop/state.ts";
import { improvementText, progressPercent, renderLoopWidget, updateLoopWidget } from "../extensions/pi-loop/ui.ts";

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

test("loop widget renders a passive side-panel dashboard with data, prompt, and step history", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "improve the dynamic loop interface",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now() - 123_000,
  });
  state.currentPrompt = "Continue the pi-loop workflow. Goal: improve the dynamic loop interface. Use real verification and call score_loop_result.";
  state.contextUsage = { tokens: 12_345, contextWindow: 200_000, percent: 6.17 };
  state.turnDurations = [
    { run: 1, turn: 1, globalTurn: 1, startedAt: 1, endedAt: 2, durationMs: 4_000 },
    { run: 1, turn: 2, globalTurn: 2, startedAt: 3, endedAt: 4, durationMs: 7_000 },
  ];

  for (let turn = 1; turn <= 7; turn++) {
    state.results.push(progressEntry(turn, turn === 1 ? null : turn * 2.5));
  }

  const lines = renderLoopWidget(state, 52, plainTheme);
  const text = lines.join("\n");

  assert.match(lines[0], /pi-loop running/);
  assert.match(text, /data/);
  assert.match(text, /current prompt/);
  assert.match(text, /step history/);
  assert.match(text, /turn:/);
  assert.match(text, /time:/);
  assert.match(text, /tokens:/);
  assert.match(text, /progress:/);
  assert.match(text, /recent:/);
  assert.match(text, /Continue the pi-loop workflow/);
  assert.equal(lines.every((line) => visibleWidth(line) <= 52), true);
});

test("loop widget uses spare panel height for current prompt text", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "show more current prompt text",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });
  state.currentPrompt = Array.from({ length: 24 }, (_, index) => `prompt-line-${String(index + 1).padStart(2, "0")}-token`).join(" ");

  const lines = renderLoopWidget(state, 28, plainTheme, 80);
  const promptRows = lines.filter((line) => /prompt-line-\d{2}-token/.test(line));
  const text = lines.join("\n");

  assert.equal(promptRows.length, 24);
  assert.match(text, /prompt-line-01-token/);
  assert.match(text, /prompt-line-15-token/);
  assert.match(text, /prompt-line-24-token/);
  assert.equal(lines.every((line) => visibleWidth(line) <= 28), true);
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
  assert.match(text, /12\. waiting\s+reconstruct/);
});

test("runtime steps never mark future steps done while a loop is active", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "keep future steps honest",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });
  state.totalTurnsStarted = 1;
  state.turnsStarted = 1;

  const rows = runtimeStepRows(state);
  const activeIndex = rows.findIndex((step) => step.status === "active");

  assert.ok(activeIndex >= 0);
  assert.equal(rows.slice(activeIndex + 1).some((step) => step.status === "done"), false);
});

test("runtime steps expose only one active step and defer measure progress until agent work ends", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "fix active step display",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });
  state.totalTurnsStarted = 1;
  state.turnsStarted = 1;
  state.currentTurnStartedAt = Date.now();

  const duringWork = runtimeStepRows(state);
  const duringWorkCurrentLines = renderLoopWidget(state, 64, plainTheme).filter((line) => /\bnow\b/.test(line));
  assert.deepEqual(duringWork.filter((step) => step.status === "active").map((step) => step.label), ["agent work"]);
  assert.equal(duringWork.find((step) => step.label === "measure progress").status, "waiting");
  assert.equal(duringWorkCurrentLines.length, 1);
  assert.match(duringWorkCurrentLines[0], /agent work/);

  state.currentTurnStartedAt = null;
  const afterWork = runtimeStepRows(state);
  const afterWorkCurrentLines = renderLoopWidget(state, 64, plainTheme).filter((line) => /\bnow\b/.test(line));
  assert.deepEqual(afterWork.filter((step) => step.status === "active").map((step) => step.label), ["measure progress"]);
  assert.equal(afterWorkCurrentLines.length, 1);
  assert.match(afterWorkCurrentLines[0], /measure progress/);
});

test("prior scores do not make resume-or-stop active during later agent work", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "keep one active runtime step after the baseline",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });
  state.results.push(progressEntry(1, null));
  state.totalTurnsStarted = 2;
  state.turnsStarted = 2;
  state.currentTurnStartedAt = Date.now();

  const duringWork = runtimeStepRows(state);
  const duringWorkCurrentLines = renderLoopWidget(state, 64, plainTheme).filter((line) => /\bnow\b/.test(line));
  assert.deepEqual(duringWork.filter((step) => step.status === "active").map((step) => step.label), ["agent work"]);
  assert.equal(duringWork.find((step) => step.label === "measure progress").status, "waiting");
  assert.equal(duringWork.find((step) => step.label === "resume or stop").status, "waiting");
  assert.equal(duringWorkCurrentLines.length, 1);
  assert.match(duringWorkCurrentLines[0], /agent work/);

  state.currentTurnStartedAt = null;
  const afterWork = runtimeStepRows(state);
  const afterWorkCurrentLines = renderLoopWidget(state, 64, plainTheme).filter((line) => /\bnow\b/.test(line));
  assert.deepEqual(afterWork.filter((step) => step.status === "active").map((step) => step.label), ["measure progress"]);
  assert.equal(afterWork.find((step) => step.label === "resume or stop").status, "waiting");
  assert.equal(afterWorkCurrentLines.length, 1);
  assert.match(afterWorkCurrentLines[0], /measure progress/);
});

test("loop widget shows the full runtime step history in the expanded panel", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "make the side panel responsive at small terminal widths",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });
  state.totalTurnsStarted = 1;
  state.turnsStarted = 1;
  state.results.push(progressEntry(1, null));

  const narrowLines = renderLoopWidget(state, 40, plainTheme);
  const historyLines = narrowLines.filter((line) => /\b(done|now|next)\b/.test(line));

  assert.equal(historyLines.length, 12);
  assert.match(narrowLines.join("\n"), /> 11 now/);
  assert.equal(narrowLines.every((line) => visibleWidth(line) <= 40), true);
});

test("loop panel overlay uses Pi's non-capturing right-side overlay", () => {
  const options = floatingPanelOverlayOptions();

  assert.equal(options.anchor, "right-center");
  assert.equal(options.width, "25%");
  assert.equal(options.minWidth, 36);
  assert.equal(options.maxHeight, "100%");
  assert.equal(options.nonCapturing, true);
});

test("loop widget can render to the requested panel height", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "fill the loop panel vertically",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });

  const lines = renderLoopWidget(state, 50, plainTheme, 30);

  assert.equal(lines.length, 30);
  assert.match(lines.at(-1), /╯/);
  assert.equal(lines.every((line) => visibleWidth(line) <= 50), true);
});

test("updateLoopWidget clears the old bottom widget and opens the floating panel", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "float the UI",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });

  const calls = [];
  let renderedLines = [];
  const ctx = {
    hasUI: true,
    sessionManager: { getSessionId: () => `overlay-test-${Date.now()}` },
    getContextUsage: () => ({ tokens: 1_000, contextWindow: 100_000, percent: 1 }),
    ui: {
      theme: plainTheme,
      setWidget(name, widget) { calls.push({ type: "widget", name, widget }); },
      setStatus(name, status) { calls.push({ type: "status", name, status }); },
      custom(factory, options) {
        calls.push({ type: "custom", options });
        const component = factory({ terminal: { rows: 40 }, requestRender() {} }, plainTheme, {}, () => {});
        renderedLines = component.render(48);
        return Promise.resolve();
      },
    },
  };

  updateLoopWidget(ctx, state);

  assert.equal(calls.some((call) => call.type === "widget" && call.name === "pi-loop" && call.widget === undefined), true);
  const customCall = calls.find((call) => call.type === "custom");
  assert.equal(customCall.options.overlay, true);
  assert.equal(customCall.options.overlayOptions().nonCapturing, true);
  assert.equal(renderedLines.length, 40);
});

function progressEntry(turn, progressPercent) {
  const entry = scoreEntryFromResult(turn, `attempt ${turn}`, minimalScore, undefined, 1, turn);
  entry.baselineScore = 64;
  entry.progressPercent = progressPercent;
  entry.passedDefinition = progressPercent !== null && progressPercent > 0;
  return entry;
}
