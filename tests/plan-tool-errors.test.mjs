import assert from "node:assert/strict";
import { test } from "node:test";

import { registerPlanRuntime } from "../extensions/pi-loop/plan/plan-runtime.ts";

test("save_plan reports inactive and invalid plans as tool errors", async () => {
  const pi = mockPi();
  const ctx = mockContext();
  registerPlanRuntime(pi, {
    activateGoal() {},
    autonomyBusy: () => false,
  });
  const savePlan = pi.tools.get("save_plan");

  await assert.rejects(
    savePlan.execute("inactive", {}, undefined, undefined, ctx),
    /Plan mode is not active/,
  );

  await pi.commands.get("plan").handler("plan a safe migration", ctx);
  await assert.rejects(
    savePlan.execute("invalid", { summary: "incomplete", acceptanceCriteria: [], milestones: [] }, undefined, undefined, ctx),
    /requires at least one milestone/,
  );
});

function mockPi() {
  const activeTools = ["read", "edit", "bash"];
  return {
    commands: new Map(),
    tools: new Map(),
    handlers: new Map(),
    entries: [],
    activeTools,
    registerCommand(name, command) { this.commands.set(name, command); },
    registerTool(tool) { this.tools.set(tool.name, tool); },
    on(name, handler) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); },
    getActiveTools() { return [...this.activeTools]; },
    setActiveTools(tools) { this.activeTools = [...tools]; },
    appendEntry(customType, data) { this.entries.push({ type: "custom", customType, data }); },
    sendMessage() {},
  };
}

function mockContext() {
  return {
    hasUI: true,
    ui: {
      notify() {},
      select: async () => "Keep plan",
      editor: async () => undefined,
    },
    sessionManager: {
      getBranch: () => [],
      getEntries: () => [],
    },
  };
}
