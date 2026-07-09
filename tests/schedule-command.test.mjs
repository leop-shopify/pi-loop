import assert from "node:assert/strict";
import { test } from "node:test";

import { parseScheduleCommand } from "../extensions/pi-loop/schedule-command.ts";

test("parses an interval and scheduled prompt", () => {
  assert.deepEqual(parseScheduleCommand("5m check the deployment"), {
    command: "create",
    intervalMs: 300_000,
    prompt: "check the deployment",
  });
  assert.deepEqual(parseScheduleCommand("2h run the release review"), {
    command: "create",
    intervalMs: 7_200_000,
    prompt: "run the release review",
  });
});

test("parses task management commands", () => {
  assert.deepEqual(parseScheduleCommand("status"), { command: "status" });
  assert.deepEqual(parseScheduleCommand("pause abc12345"), { command: "pause", id: "abc12345" });
  assert.deepEqual(parseScheduleCommand("resume abc12345"), { command: "resume", id: "abc12345" });
  assert.deepEqual(parseScheduleCommand("cancel abc12345"), { command: "cancel", id: "abc12345" });
  assert.deepEqual(parseScheduleCommand("run abc12345"), { command: "run", id: "abc12345" });
  assert.deepEqual(parseScheduleCommand("clear"), { command: "clear" });
});

test("old goal-style loop input is identified instead of silently reinterpreted", () => {
  assert.deepEqual(parseScheduleCommand("Improve the test suite until coverage reaches 90%"), {
    command: "goal_migration",
    objective: "Improve the test suite until coverage reaches 90%",
  });
});

test("rejects malformed management commands instead of treating them as goals", () => {
  for (const input of ["pause", "cancel a b", "status extra", "run"]) {
    const parsed = parseScheduleCommand(input);
    assert.equal(parsed.command, "error", input);
    assert.match(parsed.message, /Usage:/);
  }
});

test("rejects sub-minute, seven-day, and empty scheduled prompts", () => {
  assert.deepEqual(parseScheduleCommand("30s check CI"), {
    command: "error",
    message: "The minimum loop interval is 1 minute.",
  });
  assert.deepEqual(parseScheduleCommand("7d weekly check"), {
    command: "error",
    message: "The maximum loop interval is 6 days.",
  });
  assert.equal(parseScheduleCommand("6d weekly check").command, "create");
  assert.deepEqual(parseScheduleCommand("5m"), {
    command: "error",
    message: "A scheduled prompt is required after the interval.",
  });
});
