import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

import { statusText } from "../extensions/pi-loop/commands.ts";
import { finalLoopSummary } from "../extensions/pi-loop/final-summary.ts";
import { floatingPanelOverlayOptions } from "../extensions/pi-loop/floating-panel.ts";
import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { appendLogEntry, deleteLog, reconstructLoopState } from "../extensions/pi-loop/log.ts";
import { loopLogPath } from "../extensions/pi-loop/paths.ts";
import { runtimeStepRows } from "../extensions/pi-loop/runtime-steps.ts";
import {
  acceptanceReady,
  createLoopState,
  deadlineReached,
  elapsedMs,
  normalTurnsStarted,
  pauseLoopTimer,
  resumeLoopTimer,
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
    deleteLog(dir);
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

    assert.equal(loopLogPath(dir).startsWith(join(homedir(), ".pi", "agent", "pi-loop", "projects")), true);
    assert.equal(loopLogPath(dir).startsWith(dir), false);

    const reconstructed = reconstructLoopState(dir);

    assert.equal(reconstructed.goal, "persist the loop");
    assert.equal(reconstructed.targetScore, 99);
    assert.equal(reconstructed.maxTurns, 3);
    assert.equal(reconstructed.results.length, 1);
    assert.equal(reconstructed.results[0].summary, "first attempt");
    assert.equal(reconstructed.active, true);
  });
});

test("state reconstructs started turns before a score is recorded", () => {
  withTempDir((dir) => {
    const state = createLoopState();
    appendLogEntry(dir, startLoopState(state, {
      goal: "preserve turn counters",
      targetScore: 90,
      maxTurns: 12,
      maxMinutes: 10,
      startedAt: Date.now(),
    }));
    appendLogEntry(dir, { type: "event", schemaVersion: 2, event: "turn_started", timestamp: Date.now(), run: 1, turn: 1, globalTurn: 1 });

    const reconstructed = reconstructLoopState(dir);

    assert.equal(reconstructed.turnsStarted, 1);
    assert.equal(reconstructed.totalTurnsStarted, 1);
    assert.equal(reconstructed.runs[0].turnsStarted, 1);
    assert.equal(runtimeStepRows(reconstructed).find((step) => step.label === "plan acceptance").status, "active");
    assert.equal(runtimeStepRows(reconstructed).find((step) => step.label === "start turn").status, "waiting");
  });
});

test("legacy acceptance readiness and turn accounting stay open after post-upgrade feedback", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "continue legacy loop",
    targetScore: 90,
    maxTurns: 3,
    maxMinutes: 10,
    startedAt: Date.now(),
  });

  state.results.push(progressEntry(1, null));
  assert.equal(acceptanceReady(state), true);

  state.turnsStarted = 2;
  state.totalTurnsStarted = 2;
  state.results.push(scoreEntryFromResult(2, "post-upgrade feedback", minimalScore, {
    rationale: "Legacy loop normal feedback.",
    fullPlan: "Continue legacy work.",
    acceptanceStatus: "missing",
    acceptanceCriteria: [],
    planTasks: [],
  }, 1, 2));
  state.results.push(scoreEntryFromResult(3, "later confirmed feedback", minimalScore, {
    rationale: "Later structured feedback.",
    fullPlan: "Continue legacy work with structured metadata.",
    acceptanceStatus: "confirmed",
    acceptanceCriteria: ["legacy loop keeps normal turn accounting"],
    planTasks: [{ id: "T1", title: "Continue legacy work", status: "in_progress" }],
  }, 1, 3));

  assert.equal(acceptanceReady(state), true);
  assert.equal(normalTurnsStarted(state), 2);
});

test("state restore ignores legacy ACE run events without constructing adapter state", () => {
  withTempDir((dir) => {
    const state = createLoopState();
    appendLogEntry(dir, startLoopState(state, {
      goal: "restore a legacy loop",
      targetScore: 90,
      maxTurns: 12,
      maxMinutes: 10,
      startedAt: Date.now(),
    }));
    for (const event of ["ace_run_started", "ace_run_completed", "ace_run_failed", "ace_run_skipped"]) {
      appendLogEntry(dir, { type: "event", schemaVersion: 2, event, timestamp: Date.now(), details: { mode: "offline", pid: 123 } });
    }

    const reconstructed = reconstructLoopState(dir);

    assert.equal(reconstructed.goal, "restore a legacy loop");
    assert.equal(reconstructed.active, true);
    assert.equal(Object.hasOwn(reconstructed, "aceRun"), false);
  });
});

test("state reconstructs historical missing-score turn counters", () => {
  withTempDir((dir) => {
    const state = createLoopState();
    appendLogEntry(dir, startLoopState(state, {
      goal: "preserve missing-score counters",
      targetScore: 90,
      maxTurns: 12,
      maxMinutes: 10,
      startedAt: Date.now(),
    }));
    appendLogEntry(dir, { type: "event", schemaVersion: 2, event: "missing_score", timestamp: Date.now(), run: 1, turn: 2, globalTurn: 2, reason: "loop_feedback was not called" });

    const reconstructed = reconstructLoopState(dir);

    assert.equal(reconstructed.turnsStarted, 2);
    assert.equal(reconstructed.totalTurnsStarted, 2);
    assert.equal(reconstructed.runs[0].turnsStarted, 2);
    assert.equal(reconstructed.unscoredConsecutiveTurns, 1);
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
  state.results.push(progressEntry(0, null));
  state.turnsStarted = 2;

  assert.equal(deadlineReached(state), true);
  assert.equal(turnLimitReached(state), true);
});

test("feedback post-processing pauses elapsed loop time", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "pause timer",
    targetScore: 90,
    maxTurns: 2,
    maxMinutes: 1,
    startedAt: 1_000,
  });

  pauseLoopTimer(state, 11_000);

  assert.equal(elapsedMs(state, 41_000), 10_000);
  assert.equal(deadlineReached(state, 71_000), false);

  resumeLoopTimer(state, 41_000);

  assert.equal(elapsedMs(state, 51_000), 20_000);
});

test("state reconstruction preserves feedback timer pauses", () => {
  withTempDir((dir) => {
    const state = createLoopState();
    appendLogEntry(dir, startLoopState(state, {
      goal: "persist feedback pause",
      targetScore: 90,
      maxTurns: 12,
      maxMinutes: 1,
      startedAt: 1_000,
    }));
    appendLogEntry(dir, { ...scoreEntryFromResult(1, "first attempt", minimalScore), timestamp: 11_000 });

    const reconstructed = reconstructLoopState(dir, 71_000);

    assert.equal(elapsedMs(reconstructed, 71_000), 10_000);
    assert.equal(deadlineReached(reconstructed, 71_000), false);
  });
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
  state.currentPrompt = "Continue the pi-loop workflow. Goal: improve the dynamic loop interface. Use real verification and call loop_feedback.";
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
  assert.doesNotMatch(text, /ace:/i);
  assert.match(text, /Now:/);
  assert.match(text, /improve the dynamic loop interface/);
  assert.doesNotMatch(text, /continue the loop with a concrete plan/);
  assert.doesNotMatch(text, /Expected:/);
  assert.doesNotMatch(text, /Continue the pi-loop workflow/);
  assert.equal(lines.every((line) => visibleWidth(line) <= 52), true);
});

test("loop widget step history renders emitted pi-loop-step messages without synthesizing lifecycle rows", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "track actual pi-loop-step messages",
    targetScore: 90,
    maxTurns: 3,
    maxMinutes: 10,
    startedAt: Date.now(),
  });
  state.stepHistory = [
    { step: "starting loop", detail: "run 1/1, 3 attempts max", run: 1, turn: 0, globalTurn: 0, timestamp: 1 },
    { step: "kickoff prompt", detail: "sent initial loop instructions", run: 1, turn: 0, globalTurn: 0, timestamp: 2 },
    { step: "planning acceptance criteria", detail: "loop 1, acceptance turn 1, total 1", run: 1, turn: 1, globalTurn: 1, timestamp: 3 },
    { step: "acceptance confirmed", detail: "criteria confirmed with trackable plan", run: 1, turn: 1, globalTurn: 1, timestamp: 4 },
  ];

  const text = renderLoopWidget(state, 78, plainTheme, 80).join("\n");

  assert.match(text, / 01 done\s+starting loop\s+- run 1\/1, 3 attempts max/);
  assert.match(text, / 02 done\s+kickoff prompt\s+- sent initial loop instructions/);
  assert.match(text, / 03 done\s+planning acceptance/);
  assert.match(text, /loop 1, acceptance turn 1, total 1/);
  assert.match(text, /> 04 now\s+acceptance confirmed\s+- criteria confirmed with trackable plan/);
  assert.doesNotMatch(text, /parse config/);
  assert.doesNotMatch(text, /measure progress/);
});

test("loop widget shows the original loop request instead of generated prompt text", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "show useful current prompt text",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });
  state.currentPrompt = [
    "Continue the pi-loop workflow with a refined prompt, not a passive retry.",
    "",
    "Goal: improve pi-loop current prompt display",
    "Last progress: +15.3% over baseline.",
    "Required new direction:",
    "- Build a concise side-panel summary of what the agent is doing now.",
    "- Show the expected outcome instead of raw continuation boilerplate.",
    "Budget: run 1/1, turn 5/20.",
  ].join("\n");

  const lines = renderLoopWidget(state, 44, plainTheme, 80);
  const text = lines.join("\n");

  assert.match(text, /Now:/);
  assert.match(text, /show useful current prompt text/);
  assert.doesNotMatch(text, /Signal:/);
  assert.doesNotMatch(text, /Plan:/);
  assert.doesNotMatch(text, /Expected:/);
  assert.doesNotMatch(text, /Continue the pi-loop workflow/);
  assert.doesNotMatch(text, /concise side-panel summary/);
  assert.equal(lines.every((line) => visibleWidth(line) <= 44), true);
});

test("final summary reports attempt outcomes without raw historical attempt text", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "summarize without stale attempt prose",
    targetScore: 90,
    maxTurns: 12,
    maxMinutes: 10,
    startedAt: Date.now(),
  });
  const stale = progressEntry(1, 10);
  stale.summary = "stale raw summary should not appear";
  stale.attempt = { rationale: "old", fullPlan: "old", actionsTaken: ["stale action should not appear"], stopIntent: "claim_done" };
  stale.outcome = "successful_improvement";
  stale.blockers = [{ severity: "blocker", message: "stale blocker should not appear" }];
  const latest = progressEntry(2, 12);
  latest.summary = "latest raw summary should not appear";
  latest.outcome = "needs_iteration";
  state.results.push(stale, latest);

  const text = finalLoopSummary(state, "stopped by user");

  assert.match(text, /Result: 2 recorded attempts; latest needs_iteration at \+12\.0% over baseline; best \+12\.0% over baseline in run 1, turn 2/);
  assert.match(text, /run 1, turn 1 — \+10\.0% over baseline — successful_improvement; 1 blocker\./);
  assert.match(text, /run 1, turn 2 — \+12\.0% over baseline — needs_iteration\./);
  assert.doesNotMatch(text, /stale raw summary/);
  assert.doesNotMatch(text, /stale action/);
  assert.doesNotMatch(text, /stale blocker/);
  assert.doesNotMatch(text, /latest raw summary/);
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
  assert.match(text, /03\. waiting\s+bounded research/);
  assert.match(text, /08\. active\s+plan acceptance/);
  assert.match(text, /10\. waiting\s+agent work/);
  assert.match(text, /14\. waiting\s+reconstruct/);
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
  state.results.push(progressEntry(0, null));
  state.totalTurnsStarted = 1;
  state.turnsStarted = 1;
  state.currentTurnStartedAt = Date.now();

  const duringWork = runtimeStepRows(state);
  assert.deepEqual(duringWork.filter((step) => step.status === "active").map((step) => step.label), ["agent work"]);
  assert.equal(duringWork.find((step) => step.label === "measure progress").status, "waiting");

  state.currentTurnStartedAt = null;
  const afterWork = runtimeStepRows(state);
  assert.deepEqual(afterWork.filter((step) => step.status === "active").map((step) => step.label), ["measure progress"]);
});

test("stale current-turn score cannot override active agent work", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "do not show resume while the agent is working",
    targetScore: 90,
    maxTurns: 12,
    maxMinutes: 10,
    startedAt: Date.now(),
  });
  state.results.push(progressEntry(3, 15.3));
  state.totalTurnsStarted = 3;
  state.turnsStarted = 3;
  state.currentTurnStartedAt = Date.now();

  const rows = runtimeStepRows(state);
  const historyText = renderLoopWidget(state, 64, plainTheme).join("\n");

  assert.deepEqual(rows.filter((step) => step.status === "active").map((step) => step.label), ["agent work"]);
  assert.equal(rows.find((step) => step.label === "resume or stop").status, "waiting");
  assert.match(historyText, /No pi-loop-step messages recorded yet/);
  assert.doesNotMatch(historyText, /> .*resume or stop/);
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
  assert.deepEqual(duringWork.filter((step) => step.status === "active").map((step) => step.label), ["agent work"]);
  assert.equal(duringWork.find((step) => step.label === "measure progress").status, "waiting");
  assert.equal(duringWork.find((step) => step.label === "resume or stop").status, "waiting");

  state.currentTurnStartedAt = null;
  const afterWork = runtimeStepRows(state);
  assert.deepEqual(afterWork.filter((step) => step.status === "active").map((step) => step.label), ["measure progress"]);
  assert.equal(afterWork.find((step) => step.label === "resume or stop").status, "waiting");
});

test("loop widget shows every recorded pi-loop-step history entry in the expanded panel", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "make the side panel responsive at small terminal widths",
    targetScore: 90,
    maxTurns: 20,
    maxMinutes: 120,
    startedAt: Date.now(),
  });
  state.stepHistory = Array.from({ length: 35 }, (_, index) => ({
    step: `step ${index + 1}`,
    detail: `detail ${index + 1}`,
    run: 1,
    turn: index + 1,
    globalTurn: index + 1,
    timestamp: index + 1,
  }));

  const narrowLines = renderLoopWidget(state, 40, plainTheme);
  const historyLines = narrowLines.filter((line) => /[> ]\s*\d{2}\s+(done|now)\b/.test(line));

  assert.equal(historyLines.length, 35);
  assert.match(narrowLines.join("\n"), /step 1/);
  assert.match(narrowLines.join("\n"), /step 35/);
  assert.doesNotMatch(narrowLines.join("\n"), /start turn/);
  assert.equal(narrowLines.every((line) => visibleWidth(line) <= 40), true);
});

test("recent turn durations wrap instead of truncating", () => {
  const state = createLoopState();
  startLoopState(state, {
    goal: "wrap recent durations",
    targetScore: 90,
    maxTurns: 12,
    maxMinutes: 10,
    startedAt: Date.now(),
  });
  state.turnDurations = [
    { run: 1, turn: 1, globalTurn: 1, startedAt: 1, endedAt: 2, durationMs: 1_399_000 },
    { run: 1, turn: 2, globalTurn: 2, startedAt: 3, endedAt: 4, durationMs: 167_000 },
    { run: 1, turn: 3, globalTurn: 3, startedAt: 5, endedAt: 6, durationMs: 658_000 },
    { run: 1, turn: 4, globalTurn: 4, startedAt: 7, endedAt: 8, durationMs: 120_000 },
  ];

  const lines = renderLoopWidget(state, 42, plainTheme, 80);
  const recentLines = lines.filter((line) => /recent:|#\d/.test(line));
  const recentText = recentLines.join("\n");

  assert.ok(recentLines.length > 1);
  assert.match(recentText, /#1 23m 19s/);
  assert.match(recentText, /#4 2m 00s/);
  assert.doesNotMatch(recentText, /…/);
  assert.equal(lines.every((line) => visibleWidth(line) <= 42), true);
});

test("loop panel overlay uses Pi's non-capturing right-side overlay", () => {
  const options = floatingPanelOverlayOptions();

  assert.equal(options.anchor, "right-center");
  assert.equal(options.width, "25%");
  assert.equal(options.minWidth, 36);
  assert.equal(options.maxHeight, "95%");
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
  assert.equal(customCall.options.overlayOptions().maxHeight, "95%");
  assert.equal(renderedLines.length, 38);
  assert.match(renderedLines.at(-1), /╯/);
});

function progressEntry(turn, progressPercent) {
  const entry = scoreEntryFromResult(turn, `attempt ${turn}`, minimalScore, undefined, 1, turn);
  entry.baselineScore = 64;
  entry.progressPercent = progressPercent;
  entry.passedDefinition = progressPercent !== null && progressPercent > 0;
  return entry;
}
