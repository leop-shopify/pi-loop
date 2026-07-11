import assert from "node:assert/strict";
import { test } from "node:test";

import { probeWorkModeCapabilities, probeWorkModes, registerWorkMode, registerWorkModeCapability, WORK_MODE_CAPABILITY_PROBE, WORK_MODE_PROBE } from "../extensions/pi-loop/work-mode.ts";

test("work-mode probes collect active ownership synchronously", () => {
  const pi = mockPi();
  registerWorkMode(pi, () => ({ owner: "other-extension", mode: "goal", active: true }));
  assert.deepEqual(probeWorkModes(pi), [{ owner: "other-extension", mode: "goal", active: true }]);
  assert.equal(pi.channels.has(WORK_MODE_PROBE), true);
});

test("work-mode capability probes identify coordinated loop owners", () => {
  const pi = mockPi();
  registerWorkModeCapability(pi, "pi-loop");
  assert.deepEqual(probeWorkModeCapabilities(pi), ["pi-loop"]);
  assert.equal(pi.channels.has(WORK_MODE_CAPABILITY_PROBE), true);
});

test("work-mode coordination fails safe without an event bus", () => {
  assert.deepEqual(probeWorkModes({}, "pi-loop"), []);
  assert.equal(registerWorkMode({}, () => ({ owner: "pi-loop", mode: "scheduled_run", active: true })), undefined);
  assert.deepEqual(probeWorkModeCapabilities({}), []);
});

test("work-mode listeners unregister cleanly across extension reloads", () => {
  const pi = mockPi();
  const unregisterMode = registerWorkMode(pi, () => ({ owner: "pi-loop", mode: "goal", active: true }));
  const unregisterCapability = registerWorkModeCapability(pi, "pi-loop");
  assert.equal(probeWorkModes(pi).length, 1);
  assert.deepEqual(probeWorkModeCapabilities(pi), ["pi-loop"]);

  unregisterMode();
  unregisterCapability();
  assert.deepEqual(probeWorkModes(pi), []);
  assert.deepEqual(probeWorkModeCapabilities(pi), []);
});

test("work-mode probes can ignore the caller's own owner", () => {
  const pi = mockPi();
  registerWorkMode(pi, () => ({ owner: "pi-loop", mode: "scheduled_run", active: true }));
  registerWorkMode(pi, () => ({ owner: "other-extension", mode: "goal", active: true }));
  assert.deepEqual(probeWorkModes(pi, "pi-loop"), [{ owner: "other-extension", mode: "goal", active: true }]);
});

function mockPi() {
  const channels = new Map();
  return {
    channels,
    events: {
      on(name, handler) {
        channels.set(name, [...(channels.get(name) ?? []), handler]);
        return () => channels.set(name, (channels.get(name) ?? []).filter((candidate) => candidate !== handler));
      },
      emit(name, payload) {
        for (const handler of channels.get(name) ?? []) handler(payload);
      },
    },
  };
}
