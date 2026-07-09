export type PlanGoalContract = {
	outcome: string;
	verification: string[];
	constraints: string[];
	boundaries: string[];
	iterationPolicy: string;
	blockedStop: string;
	acceptanceCriteria: string[];
};

export type PlanGoalTask = {
	id: string;
	title: string;
	status: PlanMilestoneStatus;
	evidence?: string;
};

export type PlanMilestoneStatus = "pending" | "in_progress" | "completed" | "blocked";

export type PlanMilestone = {
	id: string;
	title: string;
	outcome: string;
	steps: string[];
	verification: string[];
	status: PlanMilestoneStatus;
};

export type PlanDocument = {
	version: 1;
	id: string;
	prompt: string;
	summary: string;
	context: string[];
	constraints: string[];
	boundaries: string[];
	acceptanceCriteria: string[];
	milestones: PlanMilestone[];
	risks: string[];
	decisions: string[];
	createdAt: number;
	updatedAt: number;
};

export type PlanInput = {
	summary?: string;
	context?: string[];
	constraints?: string[];
	boundaries?: string[];
	acceptanceCriteria?: string[];
	milestones?: Array<Omit<PlanMilestone, "status"> & { status?: PlanMilestoneStatus }>;
	risks?: string[];
	decisions?: string[];
};

function strings(values: unknown): string[] {
	if (!Array.isArray(values)) return [];
	return [...new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean))];
}

function milestones(values: PlanInput["milestones"]): PlanMilestone[] {
	return (values ?? []).flatMap((value, index) => {
		const id = value.id?.trim() || `M${index + 1}`;
		const title = value.title?.trim();
		const outcome = value.outcome?.trim();
		if (!title || !outcome) return [];
		return [{
			id,
			title,
			outcome,
			steps: strings(value.steps),
			verification: strings(value.verification),
			status: value.status ?? "pending",
		}];
	});
}

export function createPlan(
	prompt: string,
	input: PlanInput,
	now = Date.now(),
	random = Math.random(),
): PlanDocument {
	const planMilestones = milestones(input.milestones);
	const acceptanceCriteria = strings(input.acceptanceCriteria);
	if (planMilestones.length === 0) throw new Error("A structured plan requires at least one milestone.");
	if (acceptanceCriteria.length === 0) throw new Error("A structured plan requires at least one acceptance criterion.");
	return {
		version: 1,
		id: `${now}-${random.toString(16).slice(2)}`,
		prompt: prompt.trim(),
		summary: input.summary?.trim() || prompt.trim(),
		context: strings(input.context),
		constraints: strings(input.constraints),
		boundaries: strings(input.boundaries),
		acceptanceCriteria,
		milestones: planMilestones,
		risks: strings(input.risks),
		decisions: strings(input.decisions),
		createdAt: now,
		updatedAt: now,
	};
}

export function goalContractFromPlan(plan: PlanDocument): PlanGoalContract {
	const outcome = (plan.summary ?? plan.prompt).trim();
	const acceptanceCriteria = strings(plan.acceptanceCriteria);
	return {
		outcome,
		verification: strings(plan.milestones.flatMap((milestone) => milestone.verification)),
		constraints: strings(plan.constraints),
		boundaries: strings(plan.boundaries),
		acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : [outcome],
		iterationPolicy: "Execute one milestone at a time, verify its outcome before continuing, and keep plan progress current.",
		blockedStop: "If a milestone is blocked or no defensible path remains, stop with evidence, attempted paths, the blocker, and the next user decision needed.",
	};
}

export function goalTasksFromPlan(plan: PlanDocument): PlanGoalTask[] {
	return plan.milestones.map((milestone) => ({
		id: milestone.id,
		title: milestone.title,
		status: milestone.status,
		evidence: milestone.outcome,
	}));
}

export function formatPlan(plan: PlanDocument): string {
	return [
		`Plan: ${plan.summary}`,
		`Acceptance: ${plan.acceptanceCriteria.join("; ")}`,
		...plan.milestones.map((milestone) => `${milestone.id} [${milestone.status}] ${milestone.title}: ${milestone.outcome}\n  Steps: ${milestone.steps.join("; ") || "none"}\n  Verify: ${milestone.verification.join("; ") || "not specified"}`),
		plan.risks.length ? `Risks: ${plan.risks.join("; ")}` : "",
	].filter(Boolean).join("\n");
}
