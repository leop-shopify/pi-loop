import assert from "node:assert/strict";
import { test } from "node:test";

import { AGENT_END_SETTLE_MS, COMPACTION_SETTLE_MS, createAgentEndGate } from "../extensions/pi-loop/agent-end-gate.ts";

test("retry candidates collect terminal callbacks and retry start discards them", async () => {
  const timers = fakeTimers();
  const gate = createAgentEndGate(timers.options);
  const event = agentEnd("error", "503 service unavailable");
  const calls = [];

  await gate.defer(event, {}, () => calls.push("goal"));
  await gate.defer(event, {}, () => calls.push("scheduler"));

  assert.deepEqual(calls, []);
  assert.equal(timers.handles.length, 1);
  assert.equal(timers.handles[0].delay, AGENT_END_SETTLE_MS);
  assert.equal(timers.handles[0].unrefCalled, true);
  assert.equal(gate.consumeRetryStart(), true);
  assert.equal(timers.handles[0].cleared, true);
  assert.equal(gate.consumeRetryStart(), false);

  timers.handles[0].fire();
  await Promise.resolve();
  assert.deepEqual(calls, []);
});

test("confirmed overflow compaction replaces the short fallback until retry starts", async () => {
  const timers = fakeTimers();
  const gate = createAgentEndGate(timers.options);
  const ctx = { model: { contextWindow: 1_000 } };
  const event = agentEnd("length", undefined, { input: 990, cacheRead: 0, output: 0 });
  const calls = [];

  await gate.defer(event, ctx, () => calls.push("overflow"));
  gate.compactionStarted(true);
  assert.equal(timers.handles[0].cleared, true);
  assert.equal(timers.handles[1].delay, COMPACTION_SETTLE_MS);

  timers.handles[0].fire();
  await Promise.resolve();
  assert.deepEqual(calls, []);

  gate.compactionFinished(true);
  assert.equal(timers.handles[1].cleared, true);
  assert.equal(timers.handles[2].delay, AGENT_END_SETTLE_MS);
  assert.equal(gate.consumeRetryStart(), true);
  assert.deepEqual(calls, []);
});

test("terminal fallback invokes every callback collected for the same end event", async () => {
  const timers = fakeTimers();
  const gate = createAgentEndGate(timers.options);
  const event = agentEnd("error", "429 rate limit");
  const calls = [];

  await gate.defer(event, {}, async () => calls.push("goal"));
  await gate.defer(event, {}, () => calls.push("scheduler"));
  timers.handles[0].fire();
  await Promise.resolve();

  assert.deepEqual(calls, ["goal", "scheduler"]);
  assert.equal(gate.consumeRetryStart(), false);
});

test("ordinary length and nonretryable errors run terminal work immediately", async () => {
  const timers = fakeTimers();
  const gate = createAgentEndGate(timers.options);
  const calls = [];

  await gate.defer(agentEnd("length", undefined, { input: 100, cacheRead: 0, output: 50 }), { model: { contextWindow: 1_000 } }, () => calls.push("length"));
  await gate.defer(agentEnd("error", "GoUsageLimitError: 429 quota exceeded"), {}, () => calls.push("quota"));
  await gate.defer(agentEnd("error", "invalid authentication credentials"), {}, () => calls.push("auth"));
  await gate.defer(agentEnd("stop"), {}, () => calls.push("success"));

  assert.deepEqual(calls, ["length", "quota", "auth", "success"]);
  assert.equal(timers.handles.length, 0);
  assert.equal(gate.consumeRetryStart(), false);
});

function agentEnd(stopReason, errorMessage, usage = { input: 0, cacheRead: 0, output: 1 }) {
  return {
    messages: [{ role: "assistant", content: [], stopReason, errorMessage, usage }],
  };
}

function fakeTimers() {
  const handles = [];
  return {
    handles,
    options: {
      setTimer(callback, delay) {
        const handle = {
          delay,
          cleared: false,
          unrefCalled: false,
          fire() { if (!this.cleared) callback(); },
          unref() { this.unrefCalled = true; },
        };
        handles.push(handle);
        return handle;
      },
      clearTimer(handle) {
        handle.cleared = true;
      },
    },
  };
}
