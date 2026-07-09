const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename);
const { isReadOnlyPlanTool } = jiti("../extensions/pi-loop/plan/plan-safety.ts");

test("Plan mode uses an explicit read-only tool allowlist", () => {
	for (const name of ["read", "agentic_search", "slack_search", "save_plan", "ask"]) {
		assert.equal(isReadOnlyPlanTool(name), true, name);
	}
	for (const name of [
		"bash",
		"edit",
		"write",
		"slack_post",
		"submit_pr_review",
		"create_goal",
		"memory_update",
		"claim_file",
		"deploy_magic",
		"unknown_custom_tool",
	]) {
		assert.equal(isReadOnlyPlanTool(name), false, name);
	}
});
