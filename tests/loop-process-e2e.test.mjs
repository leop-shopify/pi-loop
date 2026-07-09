import assert from "node:assert/strict";
import { test } from "node:test";

import piLoopExtension, { scheduledOutcome } from "../extensions/pi-loop/index.ts";

test("scheduled agent outcomes distinguish completion, failure, and cancellation", () => {
  assert.equal(scheduledOutcome({ messages: [{ role: "assistant", stopReason: "stop" }] }), "completed");
  assert.equal(scheduledOutcome({ messages: [{ role: "assistant", stopReason: "error" }] }), "failed");
  assert.equal(scheduledOutcome({ messages: [{ role: "assistant", stopReason: "length" }] }), "failed");
  assert.equal(scheduledOutcome({ messages: [{ role: "assistant", stopReason: "aborted" }] }), "cancelled");
});

test("/loop creates and manages a scheduled session task", async () => {
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);

  await pi.events.get("session_start")({}, ctx);
  await pi.commands.get("loop").handler("5m check whether CI passed", ctx);

  assert.equal(pi.commands.has("pi-loop"), true);
  assert.deepEqual([...pi.tools.keys()].sort(), ["create_goal", "get_goal", "get_plan", "loop_feedback", "save_plan"]);
  assert.equal(pi.shortcuts.size, 1);
  const task = latestState(pi).tasks[0];
  assert.equal(task.prompt, "check whether CI passed");
  assert.equal(task.intervalMs, 300_000);

  await pi.commands.get("loop").handler(`pause ${task.id}`, ctx);
  assert.equal(latestState(pi).tasks[0].status, "paused");
  await pi.commands.get("loop").handler(`resume ${task.id}`, ctx);
  assert.equal(latestState(pi).tasks[0].status, "active");

  await pi.commands.get("loop").handler("status", ctx);
  assert.match(ctx.notifications.at(-1).message, new RegExp(task.id));
  assert.match(ctx.notifications.at(-1).message, /every 5m/);
});

test("run now dispatches one bounded scheduled prompt and records history", async () => {
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);
  await pi.events.get("session_start")({}, ctx);
  await pi.commands.get("loop").handler("5m inspect new review comments", ctx);
  const task = latestState(pi).tasks[0];

  await pi.commands.get("loop").handler(`run ${task.id}`, ctx);
  await Promise.resolve();
  assert.equal(pi.messages.length, 1);
  assert.match(pi.messages[0].message.content, /Run one bounded scheduled task/);
  assert.match(pi.messages[0].message.content, /inspect new review comments/);
  assert.equal(pi.messages[0].options.triggerTurn, true);

  await pi.events.get("agent_end")({}, ctx);
  const completed = latestState(pi).tasks[0];
  assert.equal(completed.running, false);
  assert.equal(completed.history.length, 1);
});

test("Loop, Goal, and Plan arbitrate autonomous ownership inside one package", async () => {
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);
  await pi.events.get("session_start")({}, ctx);

  assert.equal(pi.commands.has("loop"), true);
  assert.equal(pi.commands.has("goal"), true);
  assert.equal(pi.commands.has("plan"), true);

  await pi.commands.get("goal").handler("verify the migration", ctx);
  await pi.commands.get("loop").handler("5m inspect CI", ctx);
  const task = latestState(pi).tasks[0];
  const messageCount = pi.messages.length;
  await pi.commands.get("loop").handler(`run ${task.id}`, ctx);
  await Promise.resolve();
  assert.equal(pi.messages.length, messageCount);
  assert.equal(latestState(pi).tasks[0].pending, true);

  await pi.commands.get("goal").handler("clear", ctx);
  await pi.commands.get("loop").handler(`run ${task.id}`, ctx);
  await Promise.resolve();
  assert.match(pi.messages.at(-1).message.content, /Run one bounded scheduled task/);

  await pi.commands.get("goal").handler("start another goal", ctx);
  assert.match(ctx.notifications.at(-1).message, /Another autonomous mode is active/);
  await pi.commands.get("plan").handler("plan another change", ctx);
  assert.match(ctx.notifications.at(-1).message, /scheduled run blocks Plan mode/);
});

test("provider retries retain Goal and scheduled ownership without double-driving", async () => {
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);
  await pi.events.get("session_start")({}, ctx);

  await pi.commands.get("goal").handler("verify retry behavior", ctx);
  await pi.events.get("agent_start")({}, ctx);
  const goalMessageCount = pi.messages.length;
  const retryableError = { messages: [{ role: "assistant", stopReason: "error", errorMessage: "503 service unavailable" }] };
  await pi.events.get("agent_end")(retryableError, ctx);
  const duringGoalRetry = await pi.tools.get("get_goal").execute("goal-retry", {}, undefined, undefined, ctx);
  assert.equal(duringGoalRetry.details.goal.active, true);
  assert.equal(duringGoalRetry.details.goal.totalTurnsStarted, 1);
  assert.equal(pi.messages.length, goalMessageCount);

  await pi.events.get("agent_start")({}, ctx);
  const afterGoalRetryStart = await pi.tools.get("get_goal").execute("goal-retry-start", {}, undefined, undefined, ctx);
  assert.equal(afterGoalRetryStart.details.goal.totalTurnsStarted, 1);
  await pi.commands.get("goal").handler("clear", ctx);

  await pi.commands.get("loop").handler("5m inspect retry", ctx);
  const task = latestState(pi).tasks[0];
  await pi.commands.get("loop").handler(`run ${task.id}`, ctx);
  await Promise.resolve();
  await pi.events.get("agent_end")(retryableError, ctx);
  assert.equal(latestState(pi).tasks[0].running, true);

  await pi.events.get("agent_start")({}, ctx);
  assert.equal(latestState(pi).tasks[0].running, true);
  await pi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
  assert.equal(latestState(pi).tasks[0].running, false);
  assert.equal(latestState(pi).tasks[0].history.at(-1).outcome, "completed");
});

test("ordinary length ends terminally while confirmed overflow retains ownership through compaction", async () => {
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);
  await pi.events.get("session_start")({}, ctx);

  await pi.commands.get("loop").handler("5m ordinary length", ctx);
  const ordinary = latestState(pi).tasks[0];
  await pi.commands.get("loop").handler(`run ${ordinary.id}`, ctx);
  await Promise.resolve();
  await pi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "length", usage: { input: 100, cacheRead: 0, output: 50 } }] }, ctx);
  assert.equal(latestState(pi).tasks[0].running, false);
  assert.equal(latestState(pi).tasks[0].history.at(-1).outcome, "failed");

  await pi.commands.get("goal").handler("manual turn after ordinary length", ctx);
  await pi.events.get("agent_start")({}, ctx);
  const manualGoal = await pi.tools.get("get_goal").execute("manual-goal", {}, undefined, undefined, ctx);
  assert.equal(manualGoal.details.goal.totalTurnsStarted, 1);
  await pi.commands.get("goal").handler("clear", ctx);
  await pi.commands.get("loop").handler(`cancel ${ordinary.id}`, ctx);

  await pi.commands.get("loop").handler("5m overflow retry", ctx);
  const overflow = latestState(pi).tasks[0];
  await pi.commands.get("loop").handler(`run ${overflow.id}`, ctx);
  await Promise.resolve();
  const overflowEnd = { messages: [{ role: "assistant", stopReason: "length", usage: { input: 990, cacheRead: 0, output: 0 } }] };
  await pi.events.get("agent_end")(overflowEnd, ctx);
  await pi.events.get("session_before_compact")({ reason: "overflow", willRetry: true }, ctx);
  assert.equal(latestState(pi).tasks[0].running, true);
  await pi.events.get("session_compact")({ reason: "overflow", willRetry: true }, ctx);
  await pi.events.get("agent_start")({}, ctx);
  assert.equal(latestState(pi).tasks[0].running, true);
  await pi.events.get("agent_end")({ messages: [{ role: "assistant", stopReason: "stop" }] }, ctx);
  assert.equal(latestState(pi).tasks[0].history.at(-1).outcome, "completed");
});

test("goal-style /loop input is not executed and points to /goal", async () => {
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);
  await pi.commands.get("loop").handler("Improve tests until coverage reaches 90%", ctx);

  assert.equal(pi.messages.length, 0);
  assert.equal(pi.entries.length, 0);
  assert.match(ctx.notifications.at(-1).message, /pi-loop now runs scheduled tasks/);
  assert.match(ctx.notifications.at(-1).message, /\/goal Improve tests until coverage reaches 90%/);
});

test("session tree navigation restores the selected branch schedule", async () => {
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);
  await pi.events.get("session_start")({}, ctx);
  await pi.commands.get("loop").handler("10m old branch task", ctx);
  const oldState = latestState(pi);
  const newState = {
    ...oldState,
    tasks: oldState.tasks.map((task) => ({ ...task, id: "newbranch", prompt: "new branch task" })),
  };
  ctx.setBranch([{ type: "custom", customType: "pi-loop-schedule", data: newState }]);

  await pi.events.get("session_tree")({}, ctx);
  await pi.commands.get("loop").handler("status", ctx);
  assert.match(ctx.notifications.at(-1).message, /new branch task/);
  assert.doesNotMatch(ctx.notifications.at(-1).message, /old branch task/);
});

test("Plan restore stays read-only and branch navigation restores prior tools", async () => {
  const planEntry = {
    type: "custom",
    customType: "pi-plan",
    data: {
      planning: true,
      plan: null,
      sourcePrompt: "plan the migration",
      advisorEnabled: true,
      toolsBeforePlan: ["read", "edit", "create_goal"],
    },
  };
  const pi = mockPi();
  pi.activeTools = ["read", "edit", "create_goal"];
  const ctx = mockContext(pi, [planEntry]);
  piLoopExtension(pi);

  await pi.events.get("session_start")({}, ctx);
  assert.deepEqual(pi.activeTools.sort(), ["read", "save_plan"]);

  ctx.setBranch([{ type: "custom", customType: "unrelated", data: {} }]);
  await pi.events.get("session_tree")({}, ctx);
  assert.deepEqual(pi.activeTools.sort(), ["create_goal", "edit", "read"]);
});

test("restored Plan yields when an intelligent Goal already owns autonomy", async () => {
  const planEntry = {
    type: "custom",
    customType: "pi-plan",
    data: {
      planning: true,
      plan: null,
      sourcePrompt: "plan a conflicting change",
      advisorEnabled: true,
      toolsBeforePlan: ["read", "edit", "create_goal"],
    },
  };
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);
  await pi.events.get("session_start")({}, ctx);
  await pi.commands.get("goal").handler("verify ownership", ctx);

  ctx.setBranch([planEntry]);
  await pi.events.get("session_tree")({}, ctx);
  assert.equal(pi.activeTools.includes("loop_feedback"), true);
  assert.equal(pi.activeTools.includes("save_plan"), false);
  await pi.commands.get("goal").handler("clear", ctx);
});

test("Goal stop remains a management command and never becomes a new objective", async () => {
  const pi = mockPi();
  const ctx = mockContext(pi);
  piLoopExtension(pi);
  await pi.events.get("session_start")({}, ctx);
  await pi.commands.get("goal").handler("verify stop behavior", ctx);
  await pi.commands.get("goal").handler("stop", ctx);

  const result = await pi.tools.get("get_goal").execute("get-goal", {}, undefined, undefined, ctx);
  assert.equal(result.details.goal.active, false);
  assert.equal(result.details.goal.objective, "verify stop behavior");
  assert.equal(result.details.goal.stopReason, "stopped by user");
  await pi.commands.get("goal").handler("clear", ctx);
  const messageCount = pi.messages.length;
  await pi.commands.get("goal").handler("stop", ctx);
  assert.equal(pi.messages.length, messageCount);
  assert.match(ctx.notifications.at(-1).message, /No intelligent Goal is active/);
});

test("session restore reloads unexpired scheduled tasks", async () => {
  const firstPi = mockPi();
  const firstCtx = mockContext(firstPi);
  piLoopExtension(firstPi);
  await firstPi.events.get("session_start")({}, firstCtx);
  await firstPi.commands.get("loop").handler("10m check the deploy", firstCtx);
  const saved = latestState(firstPi);

  const restoredPi = mockPi();
  const restoredCtx = mockContext(restoredPi, [{ type: "custom", customType: "pi-loop-schedule", data: saved }]);
  piLoopExtension(restoredPi);
  await restoredPi.events.get("session_start")({}, restoredCtx);
  await restoredPi.commands.get("loop").handler("status", restoredCtx);
  assert.match(restoredCtx.notifications.at(-1).message, /check the deploy/);
});

function latestState(pi) {
  return pi.entries.filter((entry) => entry.customType === "pi-loop-schedule").at(-1).data;
}

function mockPi() {
  const events = new Map();
  const channels = new Map();
  const lifecycle = new Map();
  events.on = (name, handler) => {
    channels.set(name, [...(channels.get(name) ?? []), handler]);
    return () => channels.set(name, (channels.get(name) ?? []).filter((candidate) => candidate !== handler));
  };
  events.emit = (name, payload) => {
    for (const handler of channels.get(name) ?? []) handler(payload);
  };
  return {
    commands: new Map(),
    tools: new Map(),
    renderers: new Map(),
    activeTools: [],
    events,
    shortcuts: new Map(),
    messages: [],
    entries: [],
    registerCommand(name, command) { this.commands.set(name, command); },
    registerTool(tool) { this.tools.set(tool.name, tool); },
    registerMessageRenderer(name, renderer) { this.renderers.set(name, renderer); },
    registerShortcut(shortcut, handler) { this.shortcuts.set(shortcut, handler); },
    getActiveTools() { return [...this.activeTools]; },
    setActiveTools(tools) { this.activeTools = [...tools]; },
    on(name, handler) {
      lifecycle.set(name, [...(lifecycle.get(name) ?? []), handler]);
      this.events.set(name, async (...args) => {
        let result;
        for (const candidate of lifecycle.get(name) ?? []) result = await candidate(...args) ?? result;
        return result;
      });
    },
    sendMessage(message, options) { this.messages.push({ message, options }); },
    sendUserMessage(text, options) { this.messages.push({ message: { content: text }, options }); },
    appendEntry(customType, data) { this.entries.push({ type: "custom", customType, data }); },
  };
}

function mockContext(pi, branchEntries = []) {
  const notifications = [];
  let branch = branchEntries;
  return {
    cwd: "/tmp/pi-loop-unified-e2e",
    model: { contextWindow: 1_000 },
    hasUI: true,
    notifications,
    ui: {
      notify(message, level) { notifications.push({ message, level }); },
      setStatus() {},
      setWidget() {},
      confirm: async () => true,
      select: async () => "Keep plan",
      editor: async () => undefined,
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
    getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
    isProjectTrusted: () => false,
    setBranch(entries) { branch = entries; },
    sessionManager: {
      getSessionId: () => "unified-e2e-session",
      getBranch: () => branch.length ? branch : pi.entries,
      getEntries: () => branch.length ? branch : pi.entries,
    },
  };
}
