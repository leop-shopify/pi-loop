import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("pi-loop packages only Goal and Loop runtime assets", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const index = readFileSync(new URL("../extensions/pi-loop/index.ts", import.meta.url), "utf8");

  assert.deepEqual(manifest.pi.extensions, ["./extensions/pi-loop/index.ts"]);
  assert.deepEqual(manifest.pi.skills, ["skills"]);
  assert.equal(manifest.pi.prompts, undefined);
  assert.equal(manifest.dependencies?.["pi-ace-adapter"], undefined);
  assert.equal(manifest.pi.extensions.some((entry) => entry.includes("pi-ace-adapter")), false);
  assert.equal(manifest.dependencies?.typebox, "1.2.14");
  assert.equal(manifest.devDependencies?.jiti, undefined);
  assert.equal(manifest.files.includes("ace"), false);
  assert.equal(manifest.files.some((entry) => /ace-context|ace-launch/.test(entry)), false);
  assert.equal(manifest.files.includes("extensions/pi-loop/plan"), false);
  assert.ok(manifest.files.includes("extensions/pi-loop/scoring"));
  assert.equal(existsSync(new URL("../extensions/pi-loop/plan", import.meta.url)), false);
  assert.equal(existsSync(new URL("../skills/pi-plan-writer", import.meta.url)), false);
  assert.equal(existsSync(new URL("../skills/pi-goal-writer/SKILL.md", import.meta.url)), true);
  assert.equal(existsSync(new URL("../extensions/pi-loop/scheduler.ts", import.meta.url)), true);
  assert.match(index, /registerIntelligentGoal/);
  assert.match(index, /createScheduler/);
  assert.match(index, /registerScheduleCommand/);
  assert.doesNotMatch(index, /registerPlanRuntime|goalObjectiveFromPlan/);
  assert.match(index, /unregisterWorkMode\?\.\(\)/);
  assert.match(index, /unregisterWorkModeCapability\?\.\(\)/);
});

test("package description and version reflect Goal and Loop ownership", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "1.0.2");
  assert.match(manifest.description, /intelligent/i);
  assert.match(manifest.description, /scheduled/i);
  assert.match(manifest.description, /goals/i);
  assert.doesNotMatch(manifest.description, /\bplan(?:ning)?\b/i);
  assert.equal(manifest.keywords.includes("planning"), false);
});
