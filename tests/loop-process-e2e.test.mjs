import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import piLoopExtension from "../extensions/pi-loop/index.ts";
import { readLogEntries } from "../extensions/pi-loop/log.ts";

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-e2e-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loop process runs from command to mocked agent score and persisted stop", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);

    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("loop").handler("Improve source.ts --minutes=10 --turns=2 --target=90", ctx);
    assert.ok(pi.activeTools.includes("score_loop_result"));
    assert.match(pi.sentMessages[0].text, /Target context snapshot:/);
    assert.match(pi.sentMessages[0].text, /scripts: test, typecheck/);

    await pi.events.get("agent_start")({}, ctx);
    const response = await pi.tools.get("score_loop_result").execute("score-1", scoreParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);

    assert.match(response.content[0].text, /Outcome: successful_no_improvement/);
    assert.equal(response.terminate, true);
    assert.equal(pi.activeTools.includes("score_loop_result"), false);

    const entries = readLogEntries(dir);
    assert.deepEqual(entries.map((entry) => entry.type), ["config", "score", "event"]);
    assert.equal(entries[0].targetContext.baseline.packageManager, "pnpm");
    assert.equal(entries[1].outcome, "successful_no_improvement");
    assert.equal(entries[1].run, 1);
    assert.equal(entries[1].globalTurn, 1);
    assert.equal(entries[1].attempt.stopIntent, "claim_done");
    assert.equal(entries[2].reason, "definition of done reached");
  });
});

test("multi-run process advances after a failed run and stops on the best passing run", async () => {
  await withTempDir(async (dir) => {
    writeProject(dir);
    const pi = mockPi();
    const ctx = mockContext(dir);
    piLoopExtension(pi);

    await pi.commands.get("loop").handler("Improve source.ts --minutes=10 --turns=1 --runs=2 --target=95", ctx);
    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("score_loop_result").execute("score-1", { ...scoreParams(), requirements: [{ description: "important", status: "missing" }] }, new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "Continuing" }] }, ctx);

    let entries = readLogEntries(dir);
    assert.deepEqual(entries.map((entry) => entry.type), ["config", "score", "event", "event"]);
    assert.equal(entries[2].event, "run_stopped");
    assert.equal(entries[3].event, "run_started");
    assert.ok(pi.activeTools.includes("score_loop_result"));

    await pi.events.get("agent_start")({}, ctx);
    await pi.tools.get("score_loop_result").execute("score-2", scoreParams(), new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({}, ctx);

    entries = readLogEntries(dir);
    assert.equal(entries.at(-2).run, 2);
    assert.equal(entries.at(-2).globalTurn, 2);
    assert.equal(entries.at(-1).reason, "definition of done reached");
    assert.equal(pi.activeTools.includes("score_loop_result"), false);
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

    let entries = readLogEntries(dir);
    assert.equal(entries.at(-1).event, "missing_score");
    assert.equal(entries.at(-1).details.claimedCompletion, true);

    await pi.tools.get("score_loop_result").execute("score-1", { ...scoreParams(), requirements: [{ description: "important", status: "missing" }] }, new AbortController().signal, () => {}, ctx);
    await pi.events.get("agent_end")({ messages: [{ role: "assistant", content: "All set" }] }, ctx);

    entries = readLogEntries(dir);
    assert.equal(entries.at(-1).event, "premature_stop");
    assert.equal(entries.at(-1).reason, "completion claim below target");
  });
});

function writeProject(dir) {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test", typecheck: "tsc --noEmit" } }));
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(dir, "source.ts"), "export const value = 1;\n");
  writeFileSync(join(dir, "source.test.mjs"), "import 'node:assert/strict';\n");
}

function scoreParams() {
  return {
    summary: "Verified source behavior with real checks.",
    attempt: { rationale: "Prove source behavior with real tests.", fullPlan: "Run targeted tests and typecheck, then score with artifact and review-gate evidence.", actionsTaken: ["ran tests", "ran typecheck"], stopIntent: "claim_done" },
    artifacts: [{ path: "source.ts", purpose: "source behavior", kind: "source" }, { path: "source.test.mjs", purpose: "behavior test", kind: "test" }],
    requirements: [{ description: "Source behavior is verified", status: "met", evidence: "targeted test passed" }],
    checks: [{ name: "tests", status: "passed", kind: "test", required: true, command: "pnpm test", exitCode: 0, evidence: "tests passed" }, { name: "typecheck", status: "passed", kind: "typecheck", required: true, command: "pnpm typecheck", exitCode: 0, evidence: "typecheck passed" }],
    tests: { files: ["source.test.mjs"], behaviorsCovered: ["source behavior"], regressionCovered: true, edgeCasesCovered: ["default"], failurePathsCovered: ["invalid"], observableAssertions: true, assertionsExerciseBehavior: true, wouldFailOnBug: true, changedCodeCovered: true, integrationOrSystemCovered: true, integrationOrContractCovered: true, usesMocksForOwnedCode: false, mockOnly: false, hasSleeps: false, flaky: false, implementationCoupled: false, externalMocksHaveContractTests: true },
    design: { responsibilitiesSplit: true, smallFiles: true, solid: true, noGodFiles: true, boundariesClear: true, singleResponsibility: true, lowCouplingHighCohesion: true, complexityControlled: true },
    rails: { relevant: false },
    operability: { limitsDefined: true, persistenceDefined: true, loggingAvailable: true, rollbackOrRecoveryDefined: true, humanStopAvailable: true },
    reviewGates: [{ name: "ci", status: "passed", kind: "ci", required: true, blocksMerge: true, scope: "ci", url: "https://ci.example/pass", evidence: "CI passed" }],
    risks: [],
  };
}

function mockPi() {
  return {
    commands: new Map(),
    tools: new Map(),
    events: new Map(),
    activeTools: [],
    sentMessages: [],
    registerCommand(name, command) { this.commands.set(name, command); },
    registerTool(tool) { this.tools.set(tool.name, tool); },
    on(name, handler) { this.events.set(name, handler); },
    getActiveTools() { return this.activeTools; },
    setActiveTools(tools) { this.activeTools = tools; },
    sendUserMessage(text, options) { this.sentMessages.push({ text, options }); },
  };
}

function mockContext(cwd) {
  return {
    cwd,
    hasUI: false,
    ui: { notify() {}, setWidget() {}, setStatus() {}, theme: { fg: (_kind, value) => value } },
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getSessionId: () => "test-session" },
  };
}
