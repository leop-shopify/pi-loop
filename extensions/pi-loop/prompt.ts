import { formatFeedbackHistory } from "./feedback-history.ts";
import { runBudgetText } from "./run-manager.ts";
import { scoringRubricSummary } from "./scoring-heuristics.ts";
import type { LoopRuntimeState } from "./state.ts";
import { formatTargetContext } from "./target-context.ts";

export function kickoffPrompt(state: LoopRuntimeState): string {
  return [
    `Start the pi-loop workflow for this goal: ${state.goal ?? ""}`,
    "First analyze the problem, files likely involved, acceptance criteria, and verification strategy.",
    "Then implement or investigate using any Pi tools that are useful.",
    state.targetContext ? formatTargetContext(state.targetContext) : "Target context snapshot: unavailable",
    "At the end of this turn, call score_loop_result with concrete evidence from the attempt plan, requirements, artifacts, verification checks, automated review gates, tests, design, Rails considerations, operability, and risks.",
    "Do not claim completion without scoring the attempt.",
    scoringRubricSummary(),
  ].join("\n\n");
}

export function continuePrompt(state: LoopRuntimeState): string {
  const last = state.results[state.results.length - 1];
  const scoreLine = last ? `Last score: ${last.score}/${last.targetScore}. Improvement: ${formatImprovement(last.improvement)}.` : "No score has been recorded yet.";
  const nextActions = last?.nextActions.length ? `Next actions from scorer:\n${last.nextActions.map((action) => `- ${action}`).join("\n")}` : "Next action: produce concrete evidence and score this loop attempt.";
  const blockers = last?.blockers.length ? `Blockers from scorer:\n${last.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.message}`).join("\n")}` : "Blockers from scorer: none";

  return [
    "Continue the pi-loop workflow.",
    `Goal: ${state.goal ?? ""}`,
    scoreLine,
    formatFeedbackHistory(state),
    blockers,
    nextActions,
    `Budget: ${runBudgetText(state)}.`,
    "Use any Pi tools that help. Prefer real verification over claims.",
    "At the end of this turn, call score_loop_result. The loop stops only when the scorer says the definition of done passed, or a limit is reached.",
  ].join("\n\n");
}

export function missingScorePrompt(state: LoopRuntimeState, claimedCompletion = false): string {
  return [
    claimedCompletion ? "The previous turn claimed completion without calling score_loop_result." : "The previous pi-loop turn ended without calling score_loop_result.",
    "Do not do more implementation work before scoring the current state.",
    `Goal: ${state.goal ?? ""}`,
    `Budget: ${runBudgetText(state)}.`,
    "Call score_loop_result now with the evidence you have. If evidence is missing, report the missing checks honestly so the scorer can guide the next turn.",
  ].join("\n\n");
}

export function nextRunPrompt(state: LoopRuntimeState): string {
  return [
    "Start the next pi-loop run for the same goal.",
    `Goal: ${state.goal ?? ""}`,
    `Budget: ${runBudgetText(state)}.`,
    formatFeedbackHistory(state),
    "Use a genuinely different plan from prior failed attempts, then call score_loop_result at the end of the turn.",
  ].join("\n\n");
}

export function systemPromptAddon(state: LoopRuntimeState): string {
  return [
    "## pi-loop mode active",
    `Goal: ${state.goal ?? ""}`,
    `Limits: ${state.maxMinutes} minutes, ${state.maxTurns} turns per run, and ${state.maxRuns} run(s). Defaults are 60 minutes, 20 turns, and 1 run unless the user configured otherwise.`,
    state.targetContext ? formatTargetContext(state.targetContext) : "Target context snapshot: unavailable",
    "A loop turn starts when the agent begins work and ends when it reports a score. The extension may restart the loop when the score is below the target.",
    "You may use any active Pi tools needed to solve the goal. The extension does not sandbox your tool choices, so be disciplined and produce evidence.",
    "You must call score_loop_result before presenting a completion claim.",
    "Include attempt.rationale and attempt.fullPlan so the extension can validate the current plan before accepting the score.",
    "Hard rules: map requirements, list artifacts, use real passed checks, include automated review gate evidence for executable changes, assert observable behavior, do not use mock-only or implementation-coupled tests, do not mock owned code, keep responsibilities split, avoid god files, and apply Rails engineering safety when Rails code is involved.",
    scoringRubricSummary(),
  ].join("\n");
}

function formatImprovement(value: number | null): string {
  if (value === null) return "n/a";
  return value > 0 ? `+${value}` : String(value);
}
