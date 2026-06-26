import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildAceLoopContext } from "../extensions/pi-loop/ace-context.ts";
import piLoopExtension from "../extensions/pi-loop/index.ts";
import { registerLoopEvents } from "../extensions/pi-loop/events.ts";
import { deleteLog, readLogEntries } from "../extensions/pi-loop/log.ts";

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-ace-"));
  try {
    return await fn(dir);
  } finally {
    deleteLog(dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("ACE loop context loads enabled pi-ace-adapter project storage", async () => {
  await withTempDir(async (dir) => {
    writeAceStorage(dir, { playbook: "Prefer focused slices with direct verification." });

    const context = await buildAceLoopContext({ cwd: dir, isProjectTrusted: () => true });

    assert.match(context, /## ACE Playbook Context/);
    assert.match(context, /Prefer focused slices with direct verification/);
    assert.match(context, /Loop pacing: keep the next attempt scoped to the 10-minute cap/);
  });
});

test("ACE loop context fails closed when disabled or malformed", async () => {
  await withTempDir(async (dir) => {
    writeAceStorage(dir, { enabled: false, playbook: "Should not appear." });
    assert.equal(await buildAceLoopContext({ cwd: dir, isProjectTrusted: () => true }), undefined);
  });

  await withTempDir(async (dir) => {
    const root = join(dir, ".pi", "ace");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "config.json"), "{not-json");
    assert.equal(await buildAceLoopContext({ cwd: dir, isProjectTrusted: () => true }), undefined);
  });
});

test("/loop kickoff includes ACE context and short capped defaults", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);
    writeAceStorage(dir, { playbook: "Start with the smallest testable behavior slice." });

    const pi = mockPi();
    const ctx = mockContext(dir, pi);
    piLoopExtension(pi);

    await pi.commands.get("loop").handler("Improve source.ts --minutes=90", ctx);

    assert.match(pi.sentMessages[0].text, /## ACE Playbook Context/);
    assert.match(pi.sentMessages[0].text, /smallest testable behavior slice/);
    assert.match(pi.notifications[0].message, /pi-loop started: 10 minutes, 12 turns per run/);
    assert.deepEqual(pi.stepMessages.map((message) => message.content), [
      "Step: starting loop — run 1/1, 12 attempts max",
      "Step: kickoff prompt — sent initial loop instructions",
    ]);

    const [config] = readLogEntries(dir);
    assert.equal(config.maxMinutes, 10);
    assert.equal(config.maxTurns, 12);
  });
});

test("scheduled continuation prompts are ACE enriched when enabled", async () => {
  await withTempDir(async (dir) => {
    writeAceStorage(dir, { playbook: "On continuation, switch to a narrower verification path." });
    const pi = mockPi();
    const state = loopState({ results: [scoreEntry()] });
    const scheduled = [];
    const controller = {
      getState: () => state,
      enforceLimits: () => false,
      scheduleResume: (_ctx, _state, message) => scheduled.push(message),
    };

    registerLoopEvents(pi, controller);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Continuing." }] }, mockContext(dir, pi));

    assert.equal(scheduled.length, 1);
    assert.match(scheduled[0], /## ACE Playbook Context/);
    assert.match(scheduled[0], /narrower verification path/);
    assert.match(scheduled[0], /verify one slice, score it, and carry unfinished work/);
    assert.deepEqual(pi.stepMessages.map((message) => message.content), [
      "Step: review loop — loop 1, turn 1/2, total 1/2",
      "Step: continuing loop — scheduled refined prompt",
    ]);
  });
});

function writeProject(dir) {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test", typecheck: "tsc --noEmit" } }));
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(dir, "source.ts"), "export const value = 1;\n");
}

function writeAceStorage(dir, { enabled = true, playbook }) {
  const root = join(dir, ".pi", "ace");
  const playbookDir = join(root, "playbooks", "default");
  mkdirSync(playbookDir, { recursive: true });
  writeFileSync(join(root, "config.json"), JSON.stringify({ version: 1, enabled, selectedPlaybook: "default", promptCharCap: 1200, validators: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  writeFileSync(join(playbookDir, "current.txt"), `${playbook}\n`);
}

function mockPi() {
  return {
    commands: new Map(),
    tools: new Map(),
    events: new Map(),
    activeTools: [],
    sentMessages: [],
    stepMessages: [],
    notifications: [],
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

function mockContext(cwd, pi = mockPi()) {
  return {
    cwd,
    ui: {
      notify(message, level) { pi.notifications.push({ message, level }); },
      setWidget() {},
      setStatus() {},
      theme: { fg: (_kind, value) => value },
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
    isProjectTrusted: () => true,
    sessionManager: { getSessionId: () => "test-session" },
  };
}

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
    pendingResumeTimer: null,
    stopReason: null,
    targetContext: null,
    runs: [{ index: 1, startedAt: Date.now(), turnsStarted: 1 }],
    prematureStopCount: 0,
    currentPrompt: null,
    currentTurnStartedAt: null,
    lastTurnDurationMs: null,
    turnDurations: [],
    contextUsage: null,
    results: [],
    ...overrides,
  };
}

function scoreEntry() {
  return {
    type: "score",
    run: 1,
    turn: 1,
    globalTurn: 1,
    timestamp: Date.now(),
    summary: "attempt",
    score: 70,
    rawScore: 70,
    targetScore: 90,
    baselineScore: 70,
    progressPercent: null,
    passedDefinition: false,
    improvement: null,
    blockers: [],
    nextActions: ["Try a different proof path"],
    categories: [{ key: "testing", label: "Testing", score: 12, max: 20, gaps: ["edge coverage missing"] }],
    attempt: { rationale: "Need evidence.", fullPlan: "Try one path.", actionsTaken: ["ran checks"] },
  };
}
