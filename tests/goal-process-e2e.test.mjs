import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import piLoopExtension from "../extensions/pi-loop/intelligent-goal.ts";
import { RESUME_DELAY_MS } from "../extensions/pi-loop/constants.ts";
import { registerLoopEvents } from "../extensions/pi-loop/events.ts";
import { appendLogEntry, deleteLog, readLogEntries } from "../extensions/pi-loop/log.ts";

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-e2e-"));
  try {
    return await fn(dir);
  } finally {
    deleteLog(dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loop_feedback rejects partial acceptance discovery without ending the turn", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);

    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("goal").handler("Plan a DIY small structure --minutes=10 --turns=2 --target=90", ctx);
    await pi.events.get("agent_start")({}, ctx);

    const response = await pi.tools.get("loop_feedback").execute("partial-acceptance", {
      summary: "The user picked a DIY small structure, but the exact structure and constraints are still unknown.",
      status: "continue",
      acceptanceStatus: "discovering",
      acceptanceCriteria: ["Plan a DIY small structure"],
      nextActions: ["Ask which DIY structure type, size, location, budget, and expected output the loop should plan first."],
    }, new AbortController().signal, () => {}, ctx);

    assert.equal(response.terminate, false);
    assert.match(response.content[0].text, /Acceptance discovery is not a loop_feedback checkpoint yet/);
    assert.match(response.content[0].text, /Do not score partial discovery or each ask_user answer/);
    const entries = readLogEntries(dir);
    assert.equal(entries.some((entry) => entry.type === "score"), false);
    assert.equal(pi.stepMessages.some((message) => message.content.startsWith("Step: feedback")), false);
  });
});

test("legacy loop_feedback without acceptance fields stays scoreable and unstructured", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);

    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("goal").handler("Continue legacy loop --minutes=10 --turns=3 --target=90", ctx);
    appendLogEntry(dir, legacyScoreEntry());
    await pi.events.get("session_start")({}, ctx);
    await pi.events.get("agent_start")({}, ctx);

    const response = await pi.tools.get("loop_feedback").execute("legacy-feedback", {
      summary: "Legacy loop made normal progress after upgrade.",
      status: "continue",
      notes: "no structured acceptance metadata was provided by this legacy turn",
    }, new AbortController().signal, () => {}, ctx);

    assert.equal(response.terminate, true);
    assert.doesNotMatch(response.content[0].text, /Acceptance discovery is not a loop_feedback checkpoint yet/);
    const scores = readLogEntries(dir).filter((entry) => entry.type === "score");
    assert.equal(scores.length, 2);
    assert.equal(scores.at(-1).attempt.acceptanceStatus, undefined);
    assert.equal(scores.at(-1).attempt.acceptanceCriteria, undefined);
    assert.equal(scores.at(-1).attempt.planTasks, undefined);
  });
});

test("Goal ignores legacy adapter storage and a stale-resolvable adapter under hostile runtime tripwires", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);
    const adapterName = ["pi", "ace", "adapter"].join("-");
    const legacyRoot = join(dir, ".pi", "ace");
    const adapterRoot = join(dir, "node_modules", adapterName);
    const importMarker = join(dir, "adapter-imported");
    const sentinel = "HOSTILE_ADAPTER_SENTINEL_MUST_NOT_APPEAR";
    mkdirSync(join(legacyRoot, "playbooks", "default"), { recursive: true });
    writeFileSync(join(legacyRoot, "config.json"), JSON.stringify({ enabled: true, selectedPlaybook: "default" }));
    writeFileSync(join(legacyRoot, "playbooks", "default", "current.txt"), sentinel);
    mkdirSync(adapterRoot, { recursive: true });
    writeFileSync(join(adapterRoot, "package.json"), JSON.stringify({ name: adapterName, type: "module", exports: { "./context": "./context.js" } }));
    writeFileSync(join(adapterRoot, "context.js"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(importMarker)}, "imported"); export async function resolveAcePromptContext() { return { text: ${JSON.stringify(sentinel)} }; }\n`);
    assert.match(createRequire(join(dir, "probe.cjs")).resolve(`${adapterName}/context`), new RegExp(`node_modules/${adapterName}/context\\.js$`));

    const forbiddenSource = [
      adapterName,
      [".", "pi", "ace"].join("/"),
      ["build", "Ace", "Loop", "Context"].join(""),
      ["launch", "Ace", "For", "Loop"].join(""),
      ["ACE", "_LOOP_CONTEXT_CHAR_CAP"].join(""),
      ["ace", "_run_"].join(""),
    ];
    for (const sourcePath of ["loop-command.ts", "events.ts", "prompt.ts", "state.ts", "log.ts", "ui.ts", "constants.ts"]) {
      const source = readFileSync(new URL(`../extensions/pi-loop/${sourcePath}`, import.meta.url), "utf8");
      for (const token of forbiddenSource) assert.doesNotMatch(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    }

    const pi = mockPi();
    const emitted = [];
    pi.events.emit = (channel) => {
      emitted.push(channel);
      if (channel === `${adapterName}:launch-daemon`) throw new Error("adapter event emission attempted");
    };
    const originalSetTimeout = globalThis.setTimeout;
    const originalLaunchers = Object.fromEntries(["spawn", "exec", "execFile", "fork"].map((name) => [name, childProcess[name]]));
    const oneSecondTimers = [];
    const processLaunches = [];
    globalThis.setTimeout = ((handler, delay, ...args) => {
      if (delay === 1_000) {
        oneSecondTimers.push(delay);
        throw new Error("legacy one-second adapter timeout attempted");
      }
      return originalSetTimeout(handler, delay, ...args);
    });
    for (const name of Object.keys(originalLaunchers)) childProcess[name] = (...args) => {
      processLaunches.push({ name, args });
      throw new Error(`unexpected process launch through ${name}`);
    };

    try {
      piLoopExtension(pi);
      await pi.commands.get("goal").handler("Improve source.ts --minutes=10 --turns=2", mockContext(dir));
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      for (const [name, fn] of Object.entries(originalLaunchers)) childProcess[name] = fn;
    }

    assert.deepEqual(emitted, []);
    assert.deepEqual(oneSecondTimers, []);
    assert.deepEqual(processLaunches, []);
    assert.equal(existsSync(importMarker), false);
    assert.doesNotMatch(pi.sentMessages[0].text, new RegExp(sentinel));
    assert.doesNotMatch(pi.sentMessages[0].text, new RegExp(["A", "CE"].join(""), "i"));
    assert.equal(readLogEntries(dir).some((entry) => typeof entry.event === "string" && entry.event.startsWith(["ace", "run"].join("_"))), false);
  });
});

test("spawn-only turns wait for agent reports instead of forcing a missing-score prompt", async () => {
  await withTempDir(async (dir) => {
    const pi = mockPi();
    const state = loopState({ results: [], unscoredConsecutiveTurns: 1 });
    const scheduled = [];
    const controller = {
      sessionKey: () => "test-session",
      getState: () => state,
      enforceLimits: () => false,
      scheduleResume: (_ctx, _state, message) => scheduled.push(message),
    };

    registerLoopEvents(pi, controller);
    await pi.events.get("agent_end")({
      messages: [{
        role: "assistant",
        content: [{ type: "toolCall", id: "spawn-1", name: "spawn_agent", arguments: { prompt: "Inspect one narrow lane." } }],
        timestamp: Date.now(),
      }],
    }, mockContext(dir));

    assert.equal(scheduled.length, 0);
    assert.equal(state.unscoredConsecutiveTurns, 0);
    assert.match(state.currentPrompt, /spawn-only turn is not scoreable progress/);
    assert.deepEqual(pi.stepMessages.map((message) => message.content), [
      "Step: review loop — loop 1, acceptance turn 1, total 1",
      "Step: delegation pending — spawned agents are running or queued; waiting for focused reports before feedback",
    ]);
    assert.equal(readLogEntries(dir).find((entry) => entry.event === "delegation_pending")?.event, "delegation_pending");
  });
});

test("running or queued child agents defer both scored and unscored Goal continuation", async () => {
  await withTempDir(async (dir) => {
    for (const results of [[], [{ score: 50 }]]) {
      const pi = mockPi();
      pi.events.emit = (name, payload) => {
        if (name === "pi-extended-teams:child-agent-lifecycle-probe") {
          payload.respond({ sessionId: "test-session", running: results.length, queued: results.length ? 0 : 1 });
        }
      };
      const state = loopState({ results, lastAgentStartScoreCount: 0 });
      const scheduled = [];
      const controller = {
        sessionKey: () => "test-session",
        getState: () => state,
        enforceLimits: () => false,
        scheduleResume: (_ctx, _state, message) => scheduled.push(message),
      };

      registerLoopEvents(pi, controller);
      await pi.events.get("agent_end")({ messages: [] }, mockContext(dir));

      assert.equal(scheduled.length, 0);
      assert.equal(state.unscoredConsecutiveTurns, 0);
      assert.match(state.currentPrompt, /spawn-only turn is not scoreable progress/);
    }
  });
});

test("a responding lifecycle provider suppresses static spawn fallback when no child agents remain", async () => {
  await withTempDir(async (dir) => {
    const pi = mockPi();
    pi.events.emit = (name, payload) => {
      if (name === "pi-extended-teams:child-agent-lifecycle-probe") {
        payload.respond({ sessionId: "test-session", running: 0, queued: 0 });
      }
    };
    const state = loopState();
    const scheduled = [];
    const controller = {
      sessionKey: () => "test-session",
      getState: () => state,
      enforceLimits: () => false,
      scheduleResume: (_ctx, _state, message) => scheduled.push(message),
    };

    registerLoopEvents(pi, controller);
    await pi.events.get("agent_end")({
      messages: [{ role: "assistant", content: [{ type: "toolCall", name: "spawn_agent" }] }],
    }, mockContext(dir));

    assert.equal(scheduled.length, 1);
    assert.equal(readLogEntries(dir).some((entry) => entry.event === "delegation_pending"), false);
  });
});

test("loop process treats lightweight feedback as progress and stops only at the configured limit", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);

    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("goal").handler("Improve source.ts --minutes=10 --turns=1 --target=90", ctx);
    assert.ok(pi.activeTools.includes("loop_feedback"));
    assert.equal(pi.commands.has("pi-goal"), true);
    assert.equal(pi.shortcuts.size, 1);
    assert.match(pi.sentMessages[0].text, /Target context snapshot:/);
    assert.match(pi.sentMessages[0].text, /scripts: test, typecheck/);
    assert.deepEqual(pi.stepMessages.map((message) => message.content), [
      "Step: starting loop — run 1/1, 1 attempts max",
      "Step: kickoff prompt — sent initial loop instructions",
    ]);

    await pi.events.get("agent_start")({}, ctx);
    recordBashCheck(ctx, "pnpm test", "tests passed");
    const baselineResponse = await pi.tools.get("loop_feedback").execute("feedback-1", weakFeedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);

    assert.match(baselineResponse.content[0].text, /Acceptance planning recorded/);
    assert.match(baselineResponse.content[0].text, /Confirmed acceptance criteria: 1/);
    assert.doesNotMatch(baselineResponse.content[0].text, /Heuristic|Raw score|Score:|Outcome:|Blockers:/);
    assert.equal(baselineResponse.terminate, true);
    assert.equal(pi.activeTools.includes("loop_feedback"), true);
    assert.ok(pi.stepMessages.some((message) => message.content === "Step: acceptance confirmed — criteria confirmed with trackable plan"));
    assert.ok(pi.stepMessages.some((message) => message.content === "Step: review loop — loop 1, turn 0/1, total 0/1"));
    await sleep(RESUME_DELAY_MS + 20);
    assert.match(pi.sentMessages.at(-1).text, /^Continue the pi-loop workflow/);
    assert.doesNotMatch(pi.sentMessages.at(-1).text, /^Start the pi-loop workflow/);

    await pi.events.get("agent_start")({}, ctx);
    recordBashCheck(ctx, "pnpm test", "tests passed");
    recordBashCheck(ctx, "pnpm typecheck", "typecheck passed");
    recordBashCheck(ctx, "pnpm audit --audit-level high", "No known vulnerabilities found");
    const improvedResponse = await pi.tools.get("loop_feedback").execute("feedback-2", feedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);

    assert.match(improvedResponse.content[0].text, /Progress: \+/);
    assert.match(improvedResponse.content[0].text, /new best recorded; continue/);
    assert.match(improvedResponse.content[0].text, /Outcome: successful_improvement/);
    assert.doesNotMatch(improvedResponse.content[0].text, /Heuristic|Raw score|Score:/);
    assert.equal(pi.activeTools.includes("loop_feedback"), false);
    assert.ok(pi.stepMessages.some((message) => message.content.startsWith("Step: starting agent work — loop 1, turn 1/1")));
    assert.ok(pi.stepMessages.some((message) => /Step: feedback — \+/.test(message.content)));

    const entries = readLogEntries(dir);
    const processEntries = entries.filter((entry) => entry.event !== "loop_step");
    assert.deepEqual(processEntries.map((entry) => entry.type), ["config", "event", "score", "event", "score", "event"]);
    assert.ok(entries.some((entry) => entry.event === "loop_step" && entry.reason === "feedback"));
    assert.equal(processEntries[0].sessionId, "test-session");
    assert.equal(processEntries[0].targetContext.baseline.packageManager, "pnpm");
    assert.equal(processEntries[1].event, "turn_started");
    assert.equal(processEntries[1].globalTurn, 1);
    assert.equal(processEntries[2].outcome, "needs_iteration");
    assert.equal(processEntries[2].run, 1);
    assert.equal(processEntries[2].globalTurn, 1);
    assert.equal(processEntries[2].attempt.stopIntent, "continue");
    assert.equal(processEntries[3].event, "turn_started");
    assert.equal(processEntries[3].globalTurn, 2);
    assert.equal(processEntries[4].outcome, "successful_improvement");
    assert.equal(processEntries[4].improvement > 0, true);
    assert.equal(processEntries[4].attempt.acceptanceStatus, "confirmed");
    assert.deepEqual(processEntries[4].attempt.acceptanceCriteria, ["source behavior is verified by the configured checks"]);
    assert.match(processEntries[5].reason, /all runs exhausted/);

    const finalMessage = pi.sentMessages.at(-1).text;
    assert.match(finalMessage, /pi-loop finished/);
    assert.match(finalMessage, /TL;DR:/);
    assert.doesNotMatch(finalMessage, /Accepted/);
    assert.match(finalMessage, /Accomplished:/);
    assert.match(finalMessage, /Loop steps:/);
    assert.match(finalMessage, /run 1, turn 1/);
    assert.match(finalMessage, /run 1, turn 2/);
  });
});

test("missing-feedback recovery records feedback without counting a new loop turn", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);

    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("goal").handler("Improve source.ts --minutes=10 --turns=3 --target=90", ctx);
    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("acceptance-ready", weakFeedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Acceptance criteria confirmed." }] }, ctx);

    await pi.events.get("agent_start")({}, ctx);
    recordBashCheck(ctx, "pnpm test", "tests passed");
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Need to record feedback." }] }, ctx);

    let processEntries = readLogEntries(dir).filter((entry) => entry.event !== "loop_step");
    assert.deepEqual(processEntries.filter((entry) => entry.event === "turn_started").map((entry) => entry.globalTurn), [1, 2]);
    assert.equal(processEntries.at(-1).event, "missing_score");

    await pi.events.get("agent_start")({}, ctx);
    const recoveryResponse = await pi.tools.get("loop_feedback").execute("feedback-recovery", feedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Feedback recorded." }] }, ctx);

    assert.equal(recoveryResponse.terminate, true);
    assert.ok(pi.stepMessages.some((message) => message.content === "Step: recording feedback — loop 1, turn 1/3, total 1/3"));

    processEntries = readLogEntries(dir).filter((entry) => entry.event !== "loop_step");
    assert.deepEqual(processEntries.filter((entry) => entry.event === "turn_started").map((entry) => entry.globalTurn), [1, 2]);
    const scores = processEntries.filter((entry) => entry.type === "score");
    assert.equal(scores.length, 2);
    assert.equal(scores[1].turn, 2);
    assert.equal(scores[1].globalTurn, 2);

    await pi.events.get("agent_start")({}, ctx);
    processEntries = readLogEntries(dir).filter((entry) => entry.event !== "loop_step");
    assert.deepEqual(processEntries.filter((entry) => entry.event === "turn_started").map((entry) => entry.globalTurn), [1, 2, 3]);
  });
});

test("pi-goal alias, hide/show commands, and shortcut control the floating panel", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);
    const pi = mockPi();
    const ctx = mockContext(dir, true);
    piLoopExtension(pi);

    await pi.commands.get("pi-goal").handler("Improve source.ts --minutes=10 --turns=2", ctx);
    assert.equal(ctx.customCalls, 1);
    assert.equal(ctx.statusSetCount, 0);

    await pi.commands.get("pi-goal").handler("hide", ctx);
    assert.equal(ctx.hiddenHandles, 1);
    assert.equal(ctx.statusSetCount, 0);

    await pi.commands.get("pi-goal").handler("show", ctx);
    assert.equal(ctx.customCalls, 2);
    assert.equal(ctx.statusSetCount, 0);

    const shortcut = [...pi.shortcuts.values()][0];
    await shortcut.handler(ctx);
    assert.equal(ctx.hiddenHandles, 2);
    assert.equal(ctx.statusSetCount, 0);
  });
});

test("loop clears extension UI when it finishes", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);
    const pi = mockPi();
    const ctx = mockContext(dir, true);
    piLoopExtension(pi);

    await pi.commands.get("goal").handler("Improve source.ts --minutes=10 --turns=2", ctx);
    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("feedback-1", weakFeedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);
    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("feedback-2", feedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);

    assert.equal(ctx.widgetCleared, true);
    assert.equal(ctx.statusCleared, true);
  });
});

test("multi-run process advances after a failed run and stops when all runs are exhausted", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);
    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("goal").handler("Improve source.ts --minutes=10 --turns=1 --runs=2 --target=95", ctx);
    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("acceptance-ready", weakFeedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Acceptance ready" }] }, ctx);
    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("feedback-1", { ...feedbackParams(), status: "blocked", notes: "important requirement missing" }, new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Continuing" }] }, ctx);

    let entries = readLogEntries(dir);
    let processEntries = entries.filter((entry) => entry.event !== "loop_step");
    assert.deepEqual(processEntries.map((entry) => entry.type), ["config", "event", "score", "event", "score", "event", "event"]);
    assert.equal(processEntries[1].event, "turn_started");
    assert.equal(processEntries[5].event, "run_stopped");
    assert.equal(processEntries[6].event, "run_started");
    assert.ok(pi.activeTools.includes("loop_feedback"));
    assert.ok(pi.stepMessages.some((message) => message.content === "Step: restarting loop 2 — run 2/2"));

    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("feedback-2", feedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);

    entries = readLogEntries(dir);
    processEntries = entries.filter((entry) => entry.event !== "loop_step");
    assert.equal(processEntries.at(-2).run, 2);
    assert.equal(processEntries.at(-2).globalTurn, 3);
    assert.match(processEntries.at(-1).reason, /all runs exhausted/);
    assert.equal(pi.activeTools.includes("loop_feedback"), false);
  });
});

test("missing score and premature completion claims are logged", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);
    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("goal").handler("Improve source.ts --minutes=10 --turns=2 --target=95", ctx);
    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("acceptance-ready", weakFeedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Acceptance ready" }] }, ctx);

    await pi.events.get("agent_start")({}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Done" }] }, ctx);

    let entries = readLogEntries(dir).filter((entry) => entry.event !== "loop_step");
    assert.equal(entries.at(-1).event, "missing_score");
    assert.equal(entries.at(-1).details.claimedCompletion, true);

    await pi.tools.get("loop_feedback").execute("feedback-1", { ...feedbackParams(), status: "blocked", notes: "important requirement missing" }, new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "All set" }] }, ctx);

    entries = readLogEntries(dir).filter((entry) => entry.event !== "loop_step");
    assert.equal(entries.at(-1).event, "premature_stop");
    assert.equal(entries.at(-1).reason, "completion claim before configured loop stop");
  });
});

function loopState(overrides = {}) {
  return {
    active: true,
    goal: "harden scorer",
    targetScore: 90,
    maxTurns: 2,
    maxMinutes: 10,
    maxRuns: 1,
    currentRun: 1,
    totalTurnsStarted: 1,
    startedAt: Date.now(),
    turnsStarted: 1,
    lastAgentStartScoreCount: 0,
    unscoredConsecutiveTurns: 0,
    pendingFeedbackTurn: null,
    pendingResumeTimer: null,
    pausedMs: 0,
    timerPausedAt: null,
    stopReason: null,
    targetContext: null,
    runs: [{ index: 1, startedAt: Date.now(), turnsStarted: 1 }],
    prematureStopCount: 0,
    currentPrompt: null,
    currentTurnStartedAt: null,
    lastTurnDurationMs: null,
    turnDurations: [],
    contextUsage: null,
    stepHistory: [],
    panelVisible: true,
    results: [],
    ...overrides,
  };
}

function legacyScoreEntry() {
  return {
    type: "score",
    run: 1,
    turn: 1,
    globalTurn: 1,
    timestamp: Date.now(),
    summary: "legacy pre-upgrade feedback",
    score: 60,
    rawScore: 60,
    targetScore: 90,
    baselineScore: 60,
    progressPercent: null,
    passedDefinition: false,
    improvement: null,
    blockers: [],
    nextActions: ["continue legacy loop work"],
    categories: [],
  };
}

function writeProject(dir) {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test", typecheck: "tsc --noEmit" } }));
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(dir, "source.ts"), "export const value = 1;\n");
  writeFileSync(join(dir, "source.test.mjs"), "import 'node:assert/strict';\n");
}

function weakFeedbackParams() {
  return {
    summary: "Partial feedback recorded; status output still needs verification.",
    status: "continue",
    notes: "targeted test passed, but status output was not validated yet",
    acceptanceStatus: "confirmed",
    acceptanceCriteria: ["source behavior is verified by the configured checks"],
    planTasks: [
      { id: "T1", title: "Run focused source test", status: "completed", evidence: "pnpm test passed" },
      { id: "T2", title: "Run typecheck", status: "pending" },
    ],
  };
}

function feedbackParams() {
  return {
    summary: "Verified source behavior with focused checks.",
    status: "ready_for_review",
    notes: "source behavior is ready for final refinement",
    planTasks: [
      { id: "T1", title: "Run focused source test", status: "completed", evidence: "pnpm test passed" },
      { id: "T2", title: "Run typecheck", status: "completed", evidence: "pnpm typecheck passed" },
    ],
    nextActions: ["carry any leftovers into the next attempt"],
  };
}

function confirmedFeedbackParams() {
  return {
    ...feedbackParams(),
    acceptanceStatus: "confirmed",
    acceptanceCriteria: ["source behavior is verified by the configured checks"],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function recordBashCheck(ctx, command, text, exitCode = 0) {
  ctx.branchEntries.push({
    type: "message",
    timestamp: new Date().toISOString(),
    message: {
      role: "toolResult",
      toolName: "bash",
      content: [{ type: "text", text }],
      isError: exitCode !== 0,
      details: { command, exitCode },
    },
  });
}

function mockPi() {
  return {
    commands: new Map(),
    tools: new Map(),
    events: new Map(),
    activeTools: [],
    sentMessages: [],
    stepMessages: [],
    shortcuts: new Map(),
    registerCommand(name, command) { this.commands.set(name, command); },
    registerShortcut(shortcut, options) { this.shortcuts.set(shortcut, options); },
    registerTool(tool) { this.tools.set(tool.name, tool); },
    on(name, handler) { this.events.set(name, handler); },
    getActiveTools() { return this.activeTools; },
    setActiveTools(tools) { this.activeTools = tools; },
    sendMessage(message, options) { this.stepMessages.push({ ...message, options }); },
    sendUserMessage(text, options) { this.sentMessages.push({ text, options }); },
  };
}

function mockContext(cwd, hasUI = false) {
  const ctx = {
    cwd,
    hasUI,
    widgetCleared: false,
    statusCleared: false,
    hiddenHandles: 0,
    customCalls: 0,
    statusSetCount: 0,
    branchEntries: [],
    ui: {
      notify() {},
      setWidget(_name, widget) { if (widget === undefined) ctx.widgetCleared = true; },
      setStatus(_name, status) { if (status === undefined) ctx.statusCleared = true; else ctx.statusSetCount++; },
      custom(factory, options) {
        ctx.customCalls++;
        const component = factory({ terminal: { rows: 40 }, requestRender() {} }, { fg: (_kind, value) => value }, {}, () => {});
        options.onHandle?.({ hide() { ctx.hiddenHandles++; component.dispose?.(); } });
        return Promise.resolve();
      },
      theme: { fg: (_kind, value) => value },
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "test-session", getBranch: () => ctx.branchEntries },
  };
  return ctx;
}
