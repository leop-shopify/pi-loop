import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { appendLogEntry } from "./log.ts";
import type { LoopController } from "./controller.ts";
import { scoreLoopResult, type LoopScoreInput } from "./scoring-heuristics.ts";
import { deadlineReached, previousScoreValue, scoreEntryFromResult, type LoopRuntimeState } from "./state.ts";
import { ScoreLoopParams } from "./tool-schema.ts";
import { updateLoopWidget } from "./ui.ts";

export function registerScoreTool(pi: ExtensionAPI, controller: LoopController): void {
  pi.registerTool({
    name: controller.scoreToolName,
    label: "Score Loop Result",
    description: "Score the current pi-loop attempt from concrete software engineering evidence. Use at the end of each loop turn.",
    promptSnippet: "Score the current loop attempt against correctness, tests, design, Rails, verification, and hardening.",
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

      const scoreParams = params as Omit<LoopScoreInput, "goal" | "previousScore" | "targetScore">;
      const result = scoreLoopResult({
        ...scoreParams,
        goal: state.goal,
        previousScore: previousScoreValue(state),
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
  if (passedDefinition) controller.finishLoop(ctx, state, "definition of done reached");
  else if (deadlineReached(state)) controller.finishLoop(ctx, state, "time limit reached");
  else updateLoopWidget(ctx, state);
}

function formatScoreResponse(result: ReturnType<typeof scoreLoopResult>): string {
  const blockerLines = result.blockers.length ? result.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.message}`).join("\n") : "none";
  const nextLines = result.nextActions.length ? result.nextActions.map((action) => `- ${action}`).join("\n") : "none";
  const categoryLines = result.categories.map((category) => `- ${category.label}: ${category.score}/${category.max}`).join("\n");
  const findingLines = result.verifierFindings.length ? result.verifierFindings.map((finding) => `- ${finding.severity}: ${finding.message}`).join("\n") : "none";
  const status = result.passedDefinition ? "definition of done passed" : "continue";

  return [
    `Score: ${result.score}/${result.targetScore} (${status})`,
    `Outcome: ${result.outcome}`,
    `Raw score: ${result.rawScore}/100`,
    `Improvement: ${result.improvement === null ? "n/a" : result.improvement > 0 ? `+${result.improvement}` : result.improvement}`,
    "Categories:",
    categoryLines,
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
    turnsStarted: state.turnsStarted,
    results: state.results,
    stopReason: state.stopReason,
  };
}
