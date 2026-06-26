import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { appendLogEntry } from "./log.ts";
import type { LoopController } from "./controller.ts";
import { refineNextActions } from "./feedback-refinement.ts";
import { formatProgressPercent } from "./progress.ts";
import { scoreLoopResult, type LoopScoreInput } from "./scoring-heuristics.ts";
import { baselineScoreValue, bestScore, previousScoreValue, scoreEntryFromResult, type LoopRuntimeState } from "./state.ts";
import { sendLoopStepMessage } from "./step-message.ts";
import { ScoreLoopParams } from "./tool-schema.ts";
import { updateLoopWidget } from "./ui.ts";

export function registerScoreTool(pi: ExtensionAPI, controller: LoopController): void {
  pi.registerTool({
    name: controller.scoreToolName,
    label: "Record Loop Evidence",
    description: "Record the current pi-loop attempt evidence. The first call becomes the hidden baseline; later calls report feedback and progress without stopping the loop by itself.",
    promptSnippet: "Record the current loop attempt evidence for feedback; score improvements are observations, not stop commands.",
    promptGuidelines: [
      "Use score_loop_result at the end of every pi-loop turn before claiming completion; scoring feedback never stops the loop by itself.",
      "Provide concrete file paths, command output, checks, and risk evidence. Missing evidence should be reported honestly.",
      "Do not mark mock-only tests or owned-code mocks as good testing evidence.",
    ],
    parameters: ScoreLoopParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = controller.getState(ctx);
      if (!state.goal) {
        return { content: [{ type: "text", text: "No pi-loop goal is active. Start one with /loop <goal>." }], details: {} };
      }

      const scoreParams = params as Omit<LoopScoreInput, "goal" | "previousScore" | "baselineScore" | "targetScore">;
      const result = scoreLoopResult({
        ...scoreParams,
        goal: state.goal,
        previousScore: previousScoreValue(state),
        bestScore: bestScore(state)?.score ?? null,
        priorAttemptPlans: priorAttemptPlans(state),
        baselineScore: baselineScoreValue(state),
        targetScore: state.targetScore,
      }, undefined, { cwd: ctx.cwd });
      const entry = scoreEntryFromResult(Math.max(1, state.turnsStarted), scoreParams.summary, result, scoreParams.attempt, state.currentRun, Math.max(1, state.totalTurnsStarted));
      state.results.push(entry);
      state.unscoredConsecutiveTurns = 0;
      appendLogEntry(ctx.cwd, entry);
      updateAfterScore(ctx, state);
      sendLoopStepMessage(pi, state, "feedback", formatProgressPercent(result.progressPercent));

      return {
        content: [{ type: "text", text: formatScoreResponse(result) }],
        details: { result, loopState: loopStateDetails(state) },
        terminate: true,
      };
    },
  });
}

function updateAfterScore(ctx: ExtensionContext, state: LoopRuntimeState): void {
  updateLoopWidget(ctx, state);
}

function priorAttemptPlans(state: LoopRuntimeState): string[] {
  return state.results.map((entry) => entry.attempt?.fullPlan?.trim()).filter((plan): plan is string => Boolean(plan));
}

export function formatScoreResponse(result: ReturnType<typeof scoreLoopResult>): string {
  const blockerLines = result.blockers.length ? result.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.message}`).join("\n") : "none";
  const nextActions = refineNextActions(result.nextActions, "Choose a materially different next action and score again.");
  const nextLines = nextActions.length ? nextActions.map((action) => `- ${action}`).join("\n") : "none";
  const findingLines = result.verifierFindings.length ? result.verifierFindings.map((finding) => `- ${finding.severity}: ${finding.message}`).join("\n") : "none";
  const progress = formatProgressPercent(result.progressPercent);
  const status = result.baselineScore === null ? "baseline recorded; continue" : result.passedDefinition ? "new best recorded; continue" : "continue";

  return [
    `Progress: ${progress} (${status})`,
    `Outcome: ${result.outcome}`,
    "Blockers:",
    blockerLines,
    "Verifier findings:",
    findingLines,
    "Next actions:",
    nextLines,
  ].join("\n");
}

function loopStateDetails(state: LoopRuntimeState) {
  return {
    active: state.active,
    goal: state.goal,
    targetScore: state.targetScore,
    maxTurns: state.maxTurns,
    maxMinutes: state.maxMinutes,
    maxRuns: state.maxRuns,
    currentRun: state.currentRun,
    totalTurnsStarted: state.totalTurnsStarted,
    startedAt: state.startedAt,
    sessionId: state.sessionId,
    turnsStarted: state.turnsStarted,
    results: state.results,
    stopReason: state.stopReason,
  };
}
