import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import piLoopExtension from "../extensions/pi-loop/index.ts";
import { deleteLog, readLogEntries } from "../extensions/pi-loop/log.ts";

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-e2e-"));
  try {
    return await fn(dir);
  } finally {
    deleteLog(dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loop process treats lightweight feedback as progress and stops only at the configured limit", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);

    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("loop").handler("Improve source.ts --minutes=10 --turns=2 --target=90", ctx);
    assert.ok(pi.activeTools.includes("loop_feedback"));
    assert.equal(pi.commands.has("pi-loop"), true);
    assert.equal(pi.shortcuts.size, 1);
    assert.match(pi.sentMessages[0].text, /Target context snapshot:/);
    assert.match(pi.sentMessages[0].text, /scripts: test, typecheck/);
    assert.deepEqual(pi.stepMessages.map((message) => message.content), [
      "Step: starting loop — run 1/1, 2 attempts max",
      "Step: kickoff prompt — sent initial loop instructions",
    ]);

    await pi.events.get("agent_start")({}, ctx);
    recordBashCheck(ctx, "pnpm test", "tests passed");
    const baselineResponse = await pi.tools.get("loop_feedback").execute("feedback-1", weakFeedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);

    assert.match(baselineResponse.content[0].text, /baseline recorded; continue/);
    assert.match(baselineResponse.content[0].text, /Outcome: needs_iteration/);
    assert.doesNotMatch(baselineResponse.content[0].text, /Heuristic|Raw score|Score:/);
    assert.equal(baselineResponse.terminate, true);
    assert.equal(pi.activeTools.includes("loop_feedback"), true);
    assert.ok(pi.stepMessages.some((message) => message.content.startsWith("Step: feedback — baseline recorded")));
    assert.ok(pi.stepMessages.some((message) => message.content === "Step: review loop — loop 1, turn 1/2, total 1/2"));

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
    assert.ok(pi.stepMessages.some((message) => message.content.startsWith("Step: starting agent work — loop 1, turn 2/2")));
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

test("pi-loop alias, hide/show commands, and shortcut control the floating panel", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);
    const pi = mockPi();
    const ctx = mockContext(dir, true);
    piLoopExtension(pi);

    await pi.commands.get("pi-loop").handler("Improve source.ts --minutes=10 --turns=2", ctx);
    assert.equal(ctx.customCalls, 1);
    assert.equal(ctx.statusSetCount, 0);

    await pi.commands.get("pi-loop").handler("hide", ctx);
    assert.equal(ctx.hiddenHandles, 1);
    assert.equal(ctx.statusSetCount, 0);

    await pi.commands.get("pi-loop").handler("show", ctx);
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

    await pi.commands.get("loop").handler("Improve source.ts --minutes=10 --turns=2", ctx);
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

    await pi.commands.get("loop").handler("Improve source.ts --minutes=10 --turns=1 --runs=2 --target=95", ctx);
    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("feedback-1", { ...feedbackParams(), status: "blocked", notes: "important requirement missing" }, new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Continuing" }] }, ctx);

    let entries = readLogEntries(dir);
    let processEntries = entries.filter((entry) => entry.event !== "loop_step");
    assert.deepEqual(processEntries.map((entry) => entry.type), ["config", "event", "score", "event", "event"]);
    assert.equal(processEntries[1].event, "turn_started");
    assert.equal(processEntries[3].event, "run_stopped");
    assert.equal(processEntries[4].event, "run_started");
    assert.ok(pi.activeTools.includes("loop_feedback"));
    assert.ok(pi.stepMessages.some((message) => message.content === "Step: restarting loop 2 — run 2/2"));

    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("loop_feedback").execute("feedback-2", feedbackParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);

    entries = readLogEntries(dir);
    processEntries = entries.filter((entry) => entry.event !== "loop_step");
    assert.equal(processEntries.at(-2).run, 2);
    assert.equal(processEntries.at(-2).globalTurn, 2);
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

    await pi.commands.get("loop").handler("Improve source.ts --minutes=10 --turns=2 --target=95", ctx);
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
  };
}

function feedbackParams() {
  return {
    summary: "Verified source behavior with focused checks.",
    status: "ready_for_review",
    notes: "source behavior is ready for final refinement",
    nextActions: ["carry any leftovers into the next attempt"],
  };
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
