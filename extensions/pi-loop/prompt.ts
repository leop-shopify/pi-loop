import { formatFeedbackHistory } from "./feedback-history.ts";
import { refineNextActions } from "./feedback-refinement.ts";
import { runBudgetText } from "./run-manager.ts";
import { scoringRubricSummary } from "./scoring-heuristics.ts";
import type { LoopRuntimeState, LoopScoreEntry } from "./state.ts";
import { formatTargetContext } from "./target-context.ts";

export interface LoopPromptOptions {
  aceContext?: string;
}

export function kickoffPrompt(state: LoopRuntimeState, options: LoopPromptOptions = {}): string {
  return [
    `Start the pi-loop workflow for this goal: ${state.goal ?? ""}`,
    "First analyze the problem, files likely involved, acceptance criteria, and verification strategy.",
    state.targetContext ? formatTargetContext(state.targetContext) : "Target context snapshot: unavailable",
    promptAceContext(options),
    initialResearchGateInstruction(),
    "Then implement or investigate using any Pi tools that are useful.",
    "Keep this attempt short: complete a verifiable slice within the loop cap and move unfinished tasks to the next scored attempt.",
    "At the end of this turn, call score_loop_result with concrete evidence from the attempt plan, requirements, artifacts, verification checks, automated review gates, tests, design, framework-specific safety when relevant, operability, and risks.",
    "Do not claim completion without scoring the attempt.",
    scoringRubricSummary(),
  ].join("\n\n");
}

export function continuePrompt(state: LoopRuntimeState, options: LoopPromptOptions = {}): string {
  const last = state.results[state.results.length - 1];
  const scoreLine = last ? `Last progress: ${formatProgress(last.progressPercent ?? null)}.` : "No baseline has been recorded yet; the first score_loop_result call records it.";
  const nextActions = last?.nextActions.length ? `Next actions from scorer:\n${refineNextActions(last.nextActions).map((action) => `- ${action}`).join("\n")}` : "Next action: produce concrete evidence and score this loop attempt.";
  const blockers = last?.blockers.length ? `Blockers from scorer:\n${last.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.message}`).join("\n")}` : "Blockers from scorer: none";

  return [
    "Continue the pi-loop workflow with a refined prompt, not a passive retry.",
    `Goal: ${state.goal ?? ""}`,
    scoreLine,
    refinementObservation(state),
    formatFeedbackHistory(state),
    promptAceContext(options),
    blockers,
    nextActions,
    `Budget: ${runBudgetText(state)}.`,
    "Strategy rule: use ACE context and scorer feedback to choose a different, verifiable slice. Do not repeat the same plan, evidence, or checks unless you explain why reuse is necessary.",
    "Progress is feedback only; verify one slice, score it, and carry unfinished work into the next scored attempt.",
    "At the end of this turn, call score_loop_result with attempt.rationale and attempt.fullPlan describing the strategy change. Set attempt.reusedPriorPlan false unless the turn is explicitly blocked.",
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

export function nextRunPrompt(state: LoopRuntimeState, options: LoopPromptOptions = {}): string {
  return [
    "Start the next pi-loop run for the same goal with a refined strategy.",
    `Goal: ${state.goal ?? ""}`,
    refinementObservation(state),
    `Budget: ${runBudgetText(state)}.`,
    formatFeedbackHistory(state),
    promptAceContext(options),
    "Use ACE context plus prior feedback to choose a genuinely different short plan. State the new direction in attempt.rationale and attempt.fullPlan, then call score_loop_result at the end of the turn.",
  ].join("\n\n");
}

export function systemPromptAddon(state: LoopRuntimeState): string {
  return [
    "## pi-loop mode active",
    `Goal: ${state.goal ?? ""}`,
    `Limits: ${state.maxMinutes} minutes, ${state.maxTurns} turns per run, and ${state.maxRuns} run(s). Defaults are 10 minutes, 12 turns, and 1 run unless the user configured otherwise; minutes are capped at 10.`,
    state.targetContext ? formatTargetContext(state.targetContext) : "Target context snapshot: unavailable",
    initialResearchGateInstruction(),
    "A loop turn starts when the agent begins work and ends when it reports evidence through score_loop_result. The extension treats the first scored turn as a hidden baseline and keeps using feedback until a configured limit or user stop is reached.",
    "You may use any active Pi tools needed to solve the goal. The extension does not sandbox your tool choices, so be disciplined and produce evidence.",
    "You must call score_loop_result before presenting a completion claim.",
    "Include attempt.rationale and attempt.fullPlan so the next refined prompt can compare strategy against prior attempts.",
    "Hard rules: map requirements, list artifacts, use real passed checks, include automated review gate evidence for executable changes, assert observable behavior, do not use mock-only or implementation-coupled tests, do not mock owned code, keep responsibilities split, avoid god files, and apply framework-specific safety when Rails or similar framework code is involved.",
    "Loop pacing: except for a justified initial research gate, finish a verifiable slice within the 10-minute cap; unfinished tasks should move to the next scored attempt.",
    scoringRubricSummary(),
  ].join("\n");
}

function promptAceContext(options: LoopPromptOptions): string | undefined {
  return options.aceContext?.trim() ? options.aceContext.trim() : undefined;
}

function initialResearchGateInstruction(): string {
  return "Initial request complexity gate: after the captured context is available, evaluate the user's first request and decide whether the normal loop context is enough. If the prompt genuinely needs extra data, information, or research before the first scored slice, insert a post-capture-context research step with a 30-minute budget instead of the normal 10-minute loop cap; you may spawn focused agents to gather content, compare sources, and organize findings before starting the official scored loop. Do not use this as a default excuse to spend time or tokens: take it only when the prompt complexity or missing information requires it, and state why.";
}

function refinementObservation(state: LoopRuntimeState): string {
  const last = state.results.at(-1);
  if (!last) return "Refined observation: no scored attempt yet. First score_loop_result call establishes the baseline.";
  return [
    "Refined observation from the previous attempt:",
    whatWasTried(last),
    whatDidNotImprove(state, last),
    requiredNewDirection(state, last),
  ].join("\n");
}

function whatWasTried(entry: LoopScoreEntry): string {
  const attempt = entry.attempt;
  const tried = attempt?.actionsTaken?.length ? attempt.actionsTaken.join("; ") : entry.summary;
  return [
    `What was tried: ${tried}`,
    attempt?.fullPlan ? `Previous plan: ${attempt.fullPlan}` : undefined,
    attempt?.rationale ? `Previous rationale: ${attempt.rationale}` : undefined,
  ].filter(Boolean).join("\n");
}

function whatDidNotImprove(state: LoopRuntimeState, entry: LoopScoreEntry): string {
  const previous = state.results.at(-2);
  const priorBest = bestBeforeLast(state);
  const signals: string[] = [];
  if (previous && sameProgress(entry, previous)) signals.push(`Plateau/repeat signal: progress repeated the previous value (${formatProgress(entry.progressPercent ?? null)}).`);
  if (previous && entry.score <= previous.score) signals.push(`Plateau/repeat signal: score did not improve over the previous attempt (${entry.score} <= ${previous.score}).`);
  if (priorBest && entry.score <= priorBest.score) signals.push(`Plateau/repeat signal: score did not beat the best prior attempt (${entry.score} <= ${priorBest.score}).`);
  if (entry.passedDefinition) signals.push("New best recorded, but this is feedback only. Do not stop just because the heuristic improved.");
  for (const blocker of entry.blockers.slice(0, 3)) signals.push(`Blocker still present: ${blocker.severity}: ${blocker.message}`);
  for (const finding of entry.verifierFindings?.slice(0, 3) ?? []) signals.push(`Verifier finding: ${finding.severity}: ${finding.message}`);
  for (const gap of categoryGaps(entry).slice(0, 4)) signals.push(`Evidence gap: ${gap}`);
  if (!signals.length) signals.push("No scorer blockers were reported, so improve by adding stronger evidence, broader checks, or a different implementation strategy rather than repeating the same proof.");
  return ["What did not improve enough:", ...signals.map((signal) => `- ${signal}`)].join("\n");
}

function requiredNewDirection(state: LoopRuntimeState, entry: LoopScoreEntry): string {
  const best = bestOverall(state);
  const actions = refineNextActions(entry.nextActions).slice(0, 3).map((action) => `- ${action}`);
  const bestLine = best ? `Best attempt to beat: run ${best.run ?? 1}, turn ${best.turn}, score ${best.score}, progress ${formatProgress(best.progressPercent ?? null)}.` : "Best attempt to beat: none yet.";
  return [
    "Required new direction:",
    `- ${bestLine}`,
    "- Choose a materially different next action before editing or testing again.",
    "- If the last attempt plateaued, branch to a different hypothesis instead of polishing the same path.",
    "- The next score must show new evidence or explain the blocker; repeated progress is not acceptance.",
    ...(actions.length ? ["Scorer-suggested directions:", ...actions] : []),
  ].join("\n");
}

function categoryGaps(entry: LoopScoreEntry): string[] {
  return entry.categories.flatMap((category) => {
    const ratio = category.max === 0 ? 1 : category.score / category.max;
    if (ratio >= 0.8) return [];
    const label = category.label ?? category.key;
    const gap = category.gaps?.[0] ?? `${category.score}/${category.max}`;
    return [`${label}: ${gap}`];
  });
}

function bestBeforeLast(state: LoopRuntimeState): LoopScoreEntry | null {
  return [...state.results.slice(0, -1)].sort(comparePromptBestEntries)[0] ?? null;
}

function bestOverall(state: LoopRuntimeState): LoopScoreEntry | null {
  return [...state.results].sort(comparePromptBestEntries)[0] ?? null;
}

function comparePromptBestEntries(a: LoopScoreEntry, b: LoopScoreEntry): number {
  const scoreDiff = b.score - a.score;
  if (scoreDiff !== 0) return scoreDiff;
  const progressDiff = (b.progressPercent ?? Number.NEGATIVE_INFINITY) - (a.progressPercent ?? Number.NEGATIVE_INFINITY);
  if (progressDiff !== 0) return progressDiff;
  const turnDiff = (b.globalTurn ?? b.turn) - (a.globalTurn ?? a.turn);
  if (turnDiff !== 0) return turnDiff;
  return b.timestamp - a.timestamp;
}

function sameProgress(current: LoopScoreEntry, previous: LoopScoreEntry): boolean {
  return current.progressPercent === previous.progressPercent;
}

function formatProgress(value: number | null): string {
  if (value === null) return "baseline recorded";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}% over baseline`;
}
