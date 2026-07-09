import assert from "node:assert/strict";
import { test } from "node:test";

import { createScheduler } from "../extensions/pi-loop/scheduler.ts";

test("scheduler dispatches due work between turns and records completion", async () => {
  let now = 1_000;
  let timerCallback;
  const pi = mockPi();
  const ctx = mockContext();
  const scheduler = createScheduler(pi, {
    now: () => now,
    setTimer(callback) { timerCallback = callback; return 1; },
    clearTimer() {},
    idFactory: () => "abc12345",
  });

  scheduler.add(ctx, "check CI", 60_000);
  assert.equal(scheduler.getState().tasks[0].nextRunAt, 61_000);

  now = 61_000;
  await timerCallback();
  assert.equal(pi.messages.length, 1);
  assert.match(pi.messages[0].message.content, /scheduled_task id="abc12345"/);
  assert.equal(pi.messages[0].options.triggerTurn, true);
  assert.equal(scheduler.getState().tasks[0].running, true);

  scheduler.onAgentEnd(ctx);
  const task = scheduler.getState().tasks[0];
  assert.equal(task.running, false);
  assert.equal(task.history.length, 1);
  assert.equal(task.nextRunAt, 121_000);
});

test("busy sessions coalesce a due run instead of overlapping or catching up repeatedly", async () => {
  let now = 1_000;
  let timerCallback;
  const pi = mockPi();
  const ctx = mockContext();
  ctx.idle = false;
  const scheduler = createScheduler(pi, {
    now: () => now,
    setTimer(callback) { timerCallback = callback; return 1; },
    clearTimer() {},
    idFactory: () => "abc12345",
  });

  scheduler.add(ctx, "check CI", 60_000);
  now = 181_000;
  await timerCallback();
  assert.equal(pi.messages.length, 0);
  assert.equal(scheduler.getState().tasks[0].pending, true);

  ctx.idle = true;
  await scheduler.tick(ctx);
  assert.equal(pi.messages.length, 1);
  assert.equal(scheduler.getState().tasks[0].running, true);
});

test("scheduler defers a due task while another autonomy owner is active", async () => {
  let now = 1_000;
  let timerCallback;
  let autonomyBusy = true;
  const pi = mockPi();
  const ctx = mockContext();
  const scheduler = createScheduler(pi, {
    now: () => now,
    setTimer(callback) { timerCallback = callback; return 1; },
    clearTimer() {},
    idFactory: () => "abc12345",
    autonomyBusy: () => autonomyBusy,
  });

  scheduler.add(ctx, "check CI", 60_000);
  now = 61_000;
  await timerCallback();
  assert.equal(pi.messages.length, 0);
  assert.equal(scheduler.getState().tasks[0].pending, true);

  autonomyBusy = false;
  await scheduler.tick(ctx);
  assert.equal(pi.messages.length, 1);
});

test("scheduler never overlaps two due scheduled tasks", async () => {
  let now = 0;
  const pi = mockPi();
  const ctx = mockContext();
  let id = 0;
  const scheduler = createScheduler(pi, {
    now: () => now,
    setTimer() { return 1; },
    clearTimer() {},
    idFactory: () => `task${++id}`,
  });
  scheduler.add(ctx, "first", 60_000);
  scheduler.add(ctx, "second", 60_000);
  now = 60_000;

  await scheduler.tick(ctx);
  await scheduler.tick(ctx);
  assert.equal(pi.messages.length, 1);
  assert.equal(scheduler.getState().tasks.filter((task) => task.running).length, 1);
  assert.equal(scheduler.getState().tasks.find((task) => !task.running).pending, true);

  scheduler.onAgentEnd(ctx, "completed");
  await scheduler.tick(ctx);
  assert.equal(pi.messages.length, 2);
});

test("expired paused tasks do not consume session capacity", () => {
  let now = 0;
  let id = 0;
  const pi = mockPi();
  const ctx = mockContext();
  const scheduler = createScheduler(pi, {
    now: () => now,
    setTimer() { return 1; },
    clearTimer() {},
    idFactory: () => `task${++id}`,
  });
  for (let index = 0; index < 50; index++) {
    const task = scheduler.add(ctx, `task ${index}`, 60_000);
    scheduler.setStatus(ctx, task.id, "paused");
  }
  now = 8 * 24 * 60 * 60 * 1_000;
  const replacement = scheduler.add(ctx, "replacement", 60_000);
  assert.equal(replacement.prompt, "replacement");
  assert.deepEqual(scheduler.getState().tasks.map((task) => task.id), [replacement.id]);
});

test("a running task retains ownership across expiry and records its terminal outcome", async () => {
  let now = 0;
  const pi = mockPi();
  const ctx = mockContext();
  const scheduler = createScheduler(pi, { now: () => now, setTimer() { return 1; }, clearTimer() {}, idFactory: () => "expiring" });
  const task = scheduler.add(ctx, "cross expiry", 60_000);
  now = task.expiresAt - 1;
  scheduler.runNow(ctx, task.id);
  assert.equal(scheduler.getState().tasks[0].running, true);

  now = task.expiresAt + 1;
  assert.equal(scheduler.getState().tasks[0].running, true);
  await scheduler.tick(ctx);
  assert.equal(pi.messages.length, 1);

  scheduler.onAgentEnd(ctx, "failed");
  const persisted = pi.entries.at(-1).data.tasks.find((candidate) => candidate.id === task.id);
  assert.equal(persisted.history.at(-1).outcome, "failed");
  assert.deepEqual(scheduler.getState().tasks, []);
});

test("agent completion records the supplied run outcome", async () => {
  let now = 0;
  const pi = mockPi();
  const ctx = mockContext();
  const scheduler = createScheduler(pi, { now: () => now, setTimer() { return 1; }, clearTimer() {}, idFactory: () => "abc12345" });
  scheduler.add(ctx, "check CI", 60_000);
  now = 60_000;
  await scheduler.tick(ctx);
  scheduler.onAgentEnd(ctx, "failed");
  assert.equal(scheduler.getState().tasks[0].history.at(-1).outcome, "failed");
});

test("scheduler persists session state and restores only unexpired tasks", () => {
  let now = 1_000;
  const pi = mockPi();
  const ctx = mockContext();
  const scheduler = createScheduler(pi, {
    now: () => now,
    setTimer() { return 1; },
    clearTimer() {},
    idFactory: () => "abc12345",
  });
  scheduler.add(ctx, "check CI", 60_000);
  const saved = pi.entries.at(-1).data;

  now = 2_000;
  const restoredPi = mockPi();
  const restored = createScheduler(restoredPi, { now: () => now, setTimer() { return 1; }, clearTimer() {} });
  restored.restore(ctx, saved);
  assert.deepEqual(restored.getState().tasks.map((task) => task.id), ["abc12345"]);
});

function mockPi() {
  return {
    messages: [],
    entries: [],
    sendMessage(message, options) { this.messages.push({ message, options }); },
    appendEntry(customType, data) { this.entries.push({ customType, data }); },
  };
}

function mockContext() {
  return {
    idle: true,
    pending: false,
    isIdle() { return this.idle; },
    hasPendingMessages() { return this.pending; },
  };
}
