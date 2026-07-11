const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const source = readFileSync(join(__dirname, "../extensions/pi-loop/plan/plan-runtime.ts"), "utf8");
const indexSource = readFileSync(join(__dirname, "../extensions/pi-loop/index.ts"), "utf8");

test("plan runtime registers structured planning surfaces", () => {
	assert.match(source, /registerCommand\("plan"/);
	assert.match(source, /name: "save_plan"/);
	assert.match(source, /name: "get_plan"/);
	assert.match(source, /createPlan\(sourcePrompt, params\)/);
});

test("plan mode keeps only explicit read-only tools and blocks unknown mutation tools", () => {
	assert.match(source, /toolsBeforePlan\.filter\(isReadOnlyPlanTool\)/);
	assert.match(source, /!isReadOnlyPlanTool\(event\.toolName\)/);
	assert.doesNotMatch(source, /isReadOnlyPlanCommand/);
	assert.match(source, /block: true/);
});

test("Plan mode persists the pre-plan tool set for safe restore after reload", () => {
	assert.match(source, /toolsBeforePlan/);
	assert.match(source, /appendEntry\(PLAN_STATE_TYPE, \{[^}]*toolsBeforePlan/s);
	assert.match(source, /toolsBeforePlan = entry\?\.data\?\.toolsBeforePlan/);
});

test("saved plans can be refined, executed once, or converted to a goal", () => {
	for (const label of ["Turn plan into a goal", "Execute once", "Refine plan", "Keep plan"]) {
		assert.match(source, new RegExp(label));
	}
	assert.match(source, /activateGoal\(ctx, plan\.prompt, goalContractFromPlan\(plan\), goalTasksFromPlan\(plan\)\)/);
});

test("ordinary prompts are never intercepted to suggest Plan or Goal mode", () => {
	assert.doesNotMatch(source, /pi\.on\("input"/);
	assert.doesNotMatch(source, /This request may benefit from a work mode/);
	assert.doesNotMatch(source, /Draft a goal contract/);
	assert.doesNotMatch(source, /Do not ask again this session/);
});

test("pi-loop installs Plan with internal intelligent Goal activation", () => {
	assert.match(indexSource, /registerIntelligentGoal/);
	assert.match(indexSource, /registerPlanRuntime/);
	assert.match(indexSource, /activateGoal:/);
	assert.match(indexSource, /goalRuntime\?\.start/);
});
