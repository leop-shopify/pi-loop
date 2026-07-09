import assert from "node:assert/strict";
import { test } from "node:test";

import {
  completeScheduledRun,
  createScheduleState,
  createScheduledTask,
  dueTask,
  restoreScheduleState,
  startScheduledRun,
} from "../extensions/pi-loop/schedule-state.ts";

test("creates a session-scoped task with seven-day expiry", () => {
  const task = createScheduledTask("check CI", 300_000, 1_000, () => "abc12345");
  assert.equal(task.id, "abc12345");
  assert.equal(task.status, "active");
  assert.equal(task.nextRunAt, 301_000);
  assert.equal(task.expiresAt, 604_801_000);
  assert.deepEqual(task.history, []);
});

test("dueTask skips paused, expired, and running tasks", () => {
  const base = createScheduledTask("check CI", 60_000, 1_000, () => "abc12345");
  assert.equal(dueTask({ ...base, nextRunAt: 2_000 }, 2_000), true);
  assert.equal(dueTask({ ...base, status: "paused", nextRunAt: 2_000 }, 2_000), false);
  assert.equal(dueTask({ ...base, running: true, nextRunAt: 2_000 }, 2_000), false);
  assert.equal(dueTask({ ...base, expiresAt: 2_000, nextRunAt: 2_000 }, 2_000), false);
});

test("completing a late run coalesces missed intervals into one future run", () => {
  const task = createScheduledTask("check CI", 60_000, 0, () => "abc12345");
  const running = startScheduledRun(task, 60_000);
  const completed = completeScheduledRun(running, 250_000, "completed");
  assert.equal(completed.running, false);
  assert.equal(completed.nextRunAt, 300_000);
  assert.equal(completed.history.length, 1);
  assert.equal(completed.history[0].scheduledAt, 60_000);
  assert.equal(completed.history[0].finishedAt, 250_000);
});

test("restoring an interrupted run records it as cancelled and queues one retry", () => {
  const task = startScheduledRun(createScheduledTask("check CI", 60_000, 0, () => "abc12345"), 60_000);
  const state = createScheduleState();
  state.tasks = [task];
  const restored = restoreScheduleState(state, 70_000);
  assert.equal(restored.tasks[0].running, false);
  assert.equal(restored.tasks[0].pending, true);
  assert.equal(restored.tasks[0].history.at(-1).outcome, "cancelled");
  assert.equal(restored.tasks[0].history.at(-1).finishedAt, 70_000);
});

test("history is bounded and restore drops expired tasks and clears running state", () => {
  let task = createScheduledTask("check CI", 60_000, 0, () => "abc12345");
  for (let index = 0; index < 25; index++) {
    task = completeScheduledRun(startScheduledRun(task, task.nextRunAt), task.nextRunAt + 1, "completed");
  }
  assert.equal(task.history.length, 20);

  const state = createScheduleState();
  state.tasks = [task, { ...task, id: "expired", expiresAt: 1 }];
  const restored = restoreScheduleState(state, 2);
  assert.deepEqual(restored.tasks.map((item) => item.id), ["abc12345"]);
  assert.equal(restored.tasks[0].running, false);
});
