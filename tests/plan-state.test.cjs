const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename);
const { createPlan, goalContractFromPlan, goalTasksFromPlan } = jiti("../extensions/pi-loop/plan/plan-state.ts");

test("createPlan normalizes a self-contained living plan", () => {
	const plan = createPlan(
		"Migrate the scheduler",
		{
			summary: " Separate goals from schedules ",
			context: [" pi-loop owns goal continuation ", "pi-goal exists"],
			constraints: ["Preserve /goal"],
			boundaries: ["No daemon"],
			acceptanceCriteria: ["/loop accepts intervals"],
			milestones: [
				{
					id: "M1",
					title: "Build scheduler",
					outcome: "Scheduled prompts run between turns",
					steps: ["Add state", "Add timer"],
					verification: ["pnpm test"],
				},
			],
			risks: ["Competing continuations"],
			decisions: ["Session scoped first"],
		},
		42,
		0.5,
	);
	assert.equal(plan.id, "42-8");
	assert.equal(plan.summary, "Separate goals from schedules");
	assert.deepEqual(plan.context, ["pi-loop owns goal continuation", "pi-goal exists"]);
	assert.equal(plan.milestones[0].status, "pending");
});

test("plan conversion produces a goal contract and trackable milestone tasks", () => {
	const plan = createPlan("Migrate the scheduler", {
		summary: "Separate goals from schedules",
		constraints: ["Preserve /goal"],
		boundaries: ["No daemon"],
		acceptanceCriteria: ["/loop accepts intervals"],
		milestones: [
			{ id: "M1", title: "Build scheduler", outcome: "Scheduling works", steps: ["Implement"], verification: ["pnpm test"] },
		],
	});
	const contract = goalContractFromPlan(plan);
	assert.equal(contract.outcome, "Separate goals from schedules");
	assert.deepEqual(contract.verification, ["pnpm test"]);
	assert.deepEqual(contract.acceptanceCriteria, ["/loop accepts intervals"]);
	assert.match(contract.iterationPolicy, /milestone/i);
	assert.deepEqual(goalTasksFromPlan(plan), [
		{ id: "M1", title: "Build scheduler", status: "pending", evidence: "Scheduling works" },
	]);
});

test("createPlan requires at least one milestone and acceptance criterion", () => {
	assert.throws(() => createPlan("Too vague", { summary: "No implementation detail" }), /milestone/i);
	assert.throws(
		() => createPlan("Missing acceptance", {
			summary: "Has a milestone",
			milestones: [{ id: "M1", title: "Do work", outcome: "Work done", steps: [], verification: [] }],
		}),
		/acceptance/i,
	);
});
