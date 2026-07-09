import type { AgentEndEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { createAgentEndGate } from "./agent-end-gate.ts";
import { registerIntelligentGoal, type IntelligentGoalRuntime } from "./intelligent-goal.ts";
import { registerPlanRuntime, type PlanRuntime } from "./plan/plan-runtime.ts";
import { registerScheduleCommand } from "./schedule-command-handler.ts";
import { createScheduler } from "./scheduler.ts";
import { probeWorkModes, registerWorkMode, registerWorkModeCapability } from "./work-mode.ts";

const STATE_TYPE = "pi-loop-schedule";

export default function piLoopExtension(pi: ExtensionAPI): void {
  let goalRuntime: IntelligentGoalRuntime | null = null;
  let planRuntime: PlanRuntime | null = null;
  const agentEndGate = createAgentEndGate();
  const externalAutonomyBusy = () => probeWorkModes(pi, "pi-loop").length > 0;
  const scheduledRunActive = () => scheduler.getState().tasks.some((task) => task.running);
  const scheduler = createScheduler(pi, {
    autonomyBusy: () => Boolean(goalRuntime?.isBusy()) || Boolean(planRuntime?.isPlanning()) || externalAutonomyBusy(),
  });

  goalRuntime = registerIntelligentGoal(pi, {
    autonomyBusy: () => scheduledRunActive() || Boolean(planRuntime?.isPlanning()) || externalAutonomyBusy(),
    agentEndGate,
  });
  planRuntime = registerPlanRuntime(pi, {
    activateGoal: (ctx, objective, contract, tasks) => {
      void goalRuntime?.start(ctx, goalObjectiveFromPlan(objective, contract, tasks));
    },
    autonomyBusy: () => Boolean(goalRuntime?.isBusy()) || scheduledRunActive() || externalAutonomyBusy(),
  });
  const unregisterWorkModeCapability = registerWorkModeCapability(pi, "pi-loop");
  const unregisterWorkMode = registerWorkMode(pi, () => {
    const goalMode = goalRuntime?.getWorkMode();
    if (goalMode) return { owner: "pi-loop", mode: goalMode, active: true };
    if (planRuntime?.isPlanning()) return { owner: "pi-loop", mode: "plan", active: true };
    if (scheduledRunActive()) return { owner: "pi-loop", mode: "scheduled_run", active: true };
    return null;
  });
  registerScheduleCommand(pi, scheduler);

  const restoreFromBranch = (ctx: ExtensionContext) => {
    const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries();
    const entry = [...entries].reverse().find((candidate) => candidate.type === "custom" && candidate.customType === STATE_TYPE) as { data?: unknown } | undefined;
    scheduler.restore(ctx, entry?.data);
  };

  pi.on("session_start", (_event, ctx) => {
    restoreFromBranch(ctx);
  });

  pi.on("session_tree", (_event, ctx) => {
    restoreFromBranch(ctx);
  });

  pi.on("agent_end", (event, ctx) => {
    if (!scheduledRunActive()) return;
    return agentEndGate.defer(event, ctx, () => scheduler.onAgentEnd(ctx, scheduledOutcome(event)));
  });

  pi.on("session_shutdown", () => {
    agentEndGate.cancel();
    scheduler.shutdown();
    unregisterWorkMode?.();
    unregisterWorkModeCapability?.();
  });
}

function goalObjectiveFromPlan(
  objective: string,
  contract: { outcome: string; verification: string[]; constraints: string[]; boundaries: string[]; acceptanceCriteria: string[]; iterationPolicy: string; blockedStop: string },
  tasks: Array<{ id: string; title: string; status: string; evidence?: string }>,
): string {
  return [
    objective,
    `Outcome: ${contract.outcome}`,
    `Verification: ${contract.verification.join("; ") || "derive concrete proof"}`,
    `Constraints: ${contract.constraints.join("; ") || "none"}`,
    `Boundaries: ${contract.boundaries.join("; ") || "none"}`,
    `Acceptance criteria: ${contract.acceptanceCriteria.join("; ")}`,
    `Milestones: ${tasks.map((task) => `${task.id} [${task.status}] ${task.title}${task.evidence ? ` — ${task.evidence}` : ""}`).join("; ")}`,
    `Iteration policy: ${contract.iterationPolicy}`,
    `Blocked stop: ${contract.blockedStop}`,
  ].join("\n\n");
}

export function scheduledOutcome(event: AgentEndEvent): "completed" | "failed" | "cancelled" {
  const assistant = [...(event.messages ?? [])].reverse().find((message) => message.role === "assistant") as { stopReason?: string; errorMessage?: string } | undefined;
  if (assistant?.stopReason === "aborted") return "cancelled";
  if (assistant?.stopReason === "error" || assistant?.stopReason === "length" || assistant?.errorMessage) return "failed";
  return "completed";
}
