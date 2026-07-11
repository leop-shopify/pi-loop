import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("pi-loop packages one native runtime without adapter dependencies or assets", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const index = readFileSync(new URL("../extensions/pi-loop/index.ts", import.meta.url), "utf8");

  assert.deepEqual(manifest.pi.extensions, ["./extensions/pi-loop/index.ts"]);
  assert.deepEqual(manifest.pi.skills, ["skills"]);
  assert.equal(manifest.pi.prompts, undefined);
  assert.equal(manifest.dependencies?.["pi-ace-adapter"], undefined);
  assert.equal(manifest.pi.extensions.some((entry) => entry.includes("pi-ace-adapter")), false);
  assert.equal(manifest.dependencies?.typebox, "1.2.14");
  assert.equal(manifest.files.includes("ace"), false);
  assert.equal(manifest.files.some((entry) => /ace-context|ace-launch/.test(entry)), false);
  assert.ok(manifest.files.includes("extensions/pi-loop/plan"));
  assert.ok(manifest.files.includes("extensions/pi-loop/scoring"));
  assert.match(index, /registerIntelligentGoal/);
  assert.match(index, /registerPlanRuntime/);
  assert.match(index, /createScheduler/);
  assert.match(index, /registerScheduleCommand/);
  assert.match(index, /unregisterWorkMode\?\.\(\)/);
  assert.match(index, /unregisterWorkModeCapability\?\.\(\)/);
});

test("package description and version reflect Loop, Goal, and Plan ownership", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "1.0.1");
  assert.match(manifest.description, /intelligent/i);
  assert.match(manifest.description, /scheduled/i);
  assert.match(manifest.description, /goals/i);
  assert.match(manifest.description, /planning/i);
});
