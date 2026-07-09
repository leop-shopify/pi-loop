import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { shouldSuggestMode } from "./intent-advisor.ts";
import { isReadOnlyPlanTool } from "./plan-safety.ts";
import {
	createPlan,
	formatPlan,
	goalContractFromPlan,
	goalTasksFromPlan,
	type PlanDocument,
	type PlanGoalContract,
	type PlanGoalTask,
} from "./plan-state.ts";

const PLAN_STATE_TYPE = "pi-plan";
const PLAN_TOOLS = ["save_plan", "get_plan"];

type PlanRuntimeOptions = {
	activateGoal: (ctx: ExtensionContext, objective: string, contract: PlanGoalContract, tasks: PlanGoalTask[]) => void;
	autonomyBusy: () => boolean;
};

export type PlanRuntime = {
	isPlanning: () => boolean;
};

type PersistedPlanState = {
	planning: boolean;
	plan: PlanDocument | null;
	sourcePrompt: string;
	advisorEnabled: boolean;
	toolsBeforePlan: string[] | null;
};

export function registerPlanRuntime(pi: ExtensionAPI, options: PlanRuntimeOptions): PlanRuntime {
	let planning = false;
	let plan: PlanDocument | null = null;
	let sourcePrompt = "";
	let advisorEnabled = true;
	let toolsBeforePlan: string[] | null = null;

	function syncPlanTools(): void {
		const active = new Set(pi.getActiveTools());
		for (const name of PLAN_TOOLS) active.delete(name);
		if (planning) active.add("save_plan");
		if (plan) active.add("get_plan");
		pi.setActiveTools([...active]);
	}

	function enableReadOnlyTools(): void {
		if (!toolsBeforePlan) toolsBeforePlan = pi.getActiveTools();
		pi.setActiveTools(toolsBeforePlan.filter(isReadOnlyPlanTool));
		syncPlanTools();
	}

	function restoreTools(): void {
		if (toolsBeforePlan) pi.setActiveTools(toolsBeforePlan);
		toolsBeforePlan = null;
		syncPlanTools();
	}

	function persist(): void {
		pi.appendEntry(PLAN_STATE_TYPE, { planning, plan, sourcePrompt, advisorEnabled, toolsBeforePlan });
	}

	function planningPrompt(prompt: string): string {
		return `Create a self-contained implementation plan for the request below. Explore the relevant code and evidence without modifying files. Resolve ambiguity through focused questions when needed. The plan must have independently verifiable milestones, exact acceptance criteria, constraints, boundaries, risks, decisions, and recovery guidance. Call save_plan with the finished structured plan before ending the turn.\n\n<planning_request>\n${prompt}\n</planning_request>`;
	}

	function startPlan(ctx: ExtensionContext, prompt: string): boolean {
		if (options.autonomyBusy()) {
			ctx.ui.notify("Another goal or scheduled run blocks Plan mode.", "warning");
			return false;
		}
		planning = true;
		plan = null;
		sourcePrompt = prompt.trim();
		enableReadOnlyTools();
		persist();
		pi.sendMessage({ customType: "pi-plan-request", content: planningPrompt(sourcePrompt), display: true }, { triggerTurn: true });
		return true;
	}

	function startGoalDraft(prompt: string): void {
		pi.sendMessage(
			{
				customType: "pi-goal-draft",
				content: `Turn the request below into a durable goal contract. Do not start implementation yet. Derive an outcome, verification surfaces, constraints, boundaries, acceptance criteria, an iteration policy, and an honest blocked stop condition. Call create_goal with those structured fields only when the contract is self-contained; ask the user if material information is missing.\n\n<goal_request>\n${prompt}\n</goal_request>`,
				display: true,
			},
			{ triggerTurn: true },
		);
	}

	pi.registerTool({
		name: "get_plan",
		label: "Get Plan",
		description: "Read the current structured implementation plan.",
		parameters: { type: "object", properties: {}, additionalProperties: false } as any,
		async execute() {
			return { content: [{ type: "text", text: plan ? formatPlan(plan) : "No plan is saved." }], details: { plan } };
		},
	});

	pi.registerTool({
		name: "save_plan",
		label: "Save Plan",
		description: "Save a self-contained living implementation plan after read-only exploration.",
		parameters: {
			type: "object",
			properties: {
				summary: { type: "string" },
				context: { type: "array", items: { type: "string" } },
				constraints: { type: "array", items: { type: "string" } },
				boundaries: { type: "array", items: { type: "string" } },
				acceptanceCriteria: { type: "array", items: { type: "string" } },
				risks: { type: "array", items: { type: "string" } },
				decisions: { type: "array", items: { type: "string" } },
				milestones: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							title: { type: "string" },
							outcome: { type: "string" },
							steps: { type: "array", items: { type: "string" } },
							verification: { type: "array", items: { type: "string" } },
						},
						required: ["id", "title", "outcome", "steps", "verification"],
						additionalProperties: false,
					},
				},
			},
			required: ["summary", "acceptanceCriteria", "milestones"],
			additionalProperties: false,
		} as any,
		async execute(_id, params: any) {
			if (!planning) throw new Error("Plan mode is not active.");
			try {
				plan = createPlan(sourcePrompt, params);
				persist();
				syncPlanTools();
				return { content: [{ type: "text", text: formatPlan(plan) }], details: { plan } };
			} catch (error) {
				throw error instanceof Error ? error : new Error(String(error));
			}
		},
	});

	pi.registerCommand("plan", {
		description: "Explore read-only and create a structured implementation plan",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (trimmed === "status") {
				ctx.ui.notify(plan ? formatPlan(plan) : planning ? "Plan mode is active; no plan has been saved yet." : "No plan is active.", "info");
				return;
			}
			if (trimmed === "clear") {
				planning = false;
				plan = null;
				sourcePrompt = "";
				restoreTools();
				persist();
				return;
			}
			startPlan(ctx, trimmed || "Create a plan for the current request and conversation context.");
		},
	});

	pi.on("tool_call", (event) => {
		if (!planning) return;
		if (!isReadOnlyPlanTool(event.toolName)) {
			return { block: true, reason: "Plan mode is read-only." };
		}
	});

	pi.on("input", async (event, ctx) => {
		const eligible = shouldSuggestMode({
			text: event.text,
			source: event.source,
			hasUI: ctx.hasUI,
			imageCount: event.images?.length ?? 0,
			busy: planning || options.autonomyBusy(),
			enabled: advisorEnabled,
		});
		if (!eligible) return { action: "continue" };
		const choice = await ctx.ui.select("This request may benefit from a work mode", [
			"Draft a goal contract",
			"Plan first",
			"Continue normally",
			"Do not ask again this session",
		]);
		if (choice === "Draft a goal contract") {
			startGoalDraft(event.text);
			return { action: "handled" };
		}
		if (choice === "Plan first") {
			return startPlan(ctx, event.text) ? { action: "handled" } : { action: "continue" };
		}
		if (choice === "Do not ask again this session") {
			advisorEnabled = false;
			persist();
		}
		return { action: "continue" };
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!planning || !plan) return;
		if (!ctx.hasUI) {
			planning = false;
			restoreTools();
			persist();
			return;
		}
		const choice = await ctx.ui.select("Plan ready", ["Turn plan into a goal", "Execute once", "Refine plan", "Keep plan"]);
		if (choice === "Turn plan into a goal") {
			if (options.autonomyBusy()) {
				ctx.ui.notify("Another autonomous mode blocks starting the goal.", "warning");
				return;
			}
			planning = false;
			restoreTools();
			persist();
			options.activateGoal(ctx, plan.prompt, goalContractFromPlan(plan), goalTasksFromPlan(plan));
			return;
		}
		if (choice === "Execute once") {
			planning = false;
			restoreTools();
			persist();
			pi.sendMessage({ customType: "pi-plan-execute", content: `Execute the approved plan once. Do not broaden scope.\n\n${formatPlan(plan)}`, display: true }, { triggerTurn: true, deliverAs: "followUp" });
			return;
		}
		if (choice === "Refine plan") {
			const refinement = await ctx.ui.editor("Refine the plan", "");
			if (refinement?.trim()) {
				plan = null;
				sourcePrompt = `${sourcePrompt}\n\nRefinement requested by the user:\n${refinement.trim()}`;
				persist();
				pi.sendMessage({ customType: "pi-plan-refine", content: planningPrompt(sourcePrompt), display: true }, { triggerTurn: true, deliverAs: "followUp" });
			}
			return;
		}
		planning = false;
		restoreTools();
		persist();
	});

	function restoreFromBranch(ctx: ExtensionContext): void {
		if (toolsBeforePlan) pi.setActiveTools(toolsBeforePlan);
		const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
		const entry = [...entries].reverse().find((candidate) => candidate.type === "custom" && candidate.customType === PLAN_STATE_TYPE) as { data?: PersistedPlanState } | undefined;
		planning = entry?.data?.planning ?? false;
		plan = entry?.data?.plan ?? null;
		sourcePrompt = entry?.data?.sourcePrompt ?? "";
		advisorEnabled = entry?.data?.advisorEnabled ?? true;
		toolsBeforePlan = entry?.data?.toolsBeforePlan ?? null;
		if (planning && options.autonomyBusy()) {
			planning = false;
			toolsBeforePlan = null;
		}
		if (planning) enableReadOnlyTools();
		else syncPlanTools();
	}

	pi.on("session_start", (_event, ctx) => restoreFromBranch(ctx));
	pi.on("session_tree", (_event, ctx) => restoreFromBranch(ctx));

	return { isPlanning: () => planning };
}
