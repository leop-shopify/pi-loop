import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { appendLogEntry } from "./log.ts";
import type { LoopController } from "./controller.ts";
import { formatProgressPercent } from "./progress.ts";
import { scoreLoopResult, type LoopScoreInput } from "./scoring-heuristics.ts";
import { baselineScoreValue, deadlineReached, previousScoreValue, scoreEntryFromResult, type LoopRuntimeState } from "./state.ts";
import { ScoreLoopParams } from "./tool-schema.ts";
import { updateLoopWidget } from "./ui.ts";

export function registerScoreTool(pi: ExtensionAPI, controller: LoopController): void {
  pi.registerTool({
    name: controller.scoreToolName,
    label: "Record Loop Evidence",
    description: "Record the current pi-loop attempt evidence. The first call becomes the hidden baseline; later calls report percent progress over that baseline.",
    promptSnippet: "Record the current loop attempt evidence for progress-over-baseline feedback.",
    promptGuidelines: [
      "Use score_loop_result at the end of every pi-loop turn before claiming completion.",
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
        baselineScore: baselineScoreValue(state),
        targetScore: state.targetScore,
      }, undefined, { cwd: ctx.cwd });
      const entry = scoreEntryFromResult(Math.max(1, state.turnsStarted), scoreParams.summary, result, scoreParams.attempt, state.currentRun, Math.max(1, state.totalTurnsStarted));
      state.results.push(entry);
      state.unscoredConsecutiveTurns = 0;
      appendLogEntry(ctx.cwd, entry);
      updateAfterScore(ctx, controller, state, result.passedDefinition);

      return {
        content: [{ type: "text", text: formatScoreResponse(result) }],
        details: { result, loopState: loopStateDetails(state) },
        terminate: true,
      };
    },
  });
}

function updateAfterScore(ctx: ExtensionContext, controller: LoopController, state: LoopRuntimeState, passedDefinition: boolean): void {
  if (passedDefinition) controller.finishLoop(ctx, state, "verified improvement accepted");
  else if (deadlineReached(state)) controller.finishLoop(ctx, state, "time limit reached");
  else updateLoopWidget(ctx, state);
}

function formatScoreResponse(result: ReturnType<typeof scoreLoopResult>): string {
  const blockerLines = result.blockers.length ? result.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.message}`).join("\n") : "none";
  const nextLines = result.nextActions.length ? result.nextActions.map((action) => `- ${action}`).join("\n") : "none";
  const findingLines = result.verifierFindings.length ? result.verifierFindings.map((finding) => `- ${finding.severity}: ${finding.message}`).join("\n") : "none";
  const progress = formatProgressPercent(result.progressPercent);
  const status = result.passedDefinition ? "verified improvement accepted" : result.baselineScore === null ? "baseline recorded; continue" : "continue";

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
