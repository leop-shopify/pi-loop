import { formatFeedbackHistory } from "./feedback-history.ts";
import { refineNextActions } from "./feedback-refinement.ts";
import { unreportedObjectives } from "./metric-feedback.ts";
import { formatNumericObjectives } from "./objectives.ts";
import { runBudgetText } from "./run-manager.ts";
import { scoringRubricSummary } from "./scoring-heuristics.ts";
import { acceptanceReady, completionClaimed, confirmationPassCount, type LoopRuntimeState, type LoopScoreEntry } from "./state.ts";
import { formatTargetContext } from "./target-context.ts";

export interface LoopPromptOptions {
  aceContext?: string;
}

export function kickoffPrompt(state: LoopRuntimeState, options: LoopPromptOptions = {}): string {
  return [
    `Start the pi-loop workflow for this goal: ${state.goal ?? ""}`,
    acceptanceCriteriaGateInstruction(),
    state.targetContext ? formatTargetContext(state.targetContext) : "Target context snapshot: unavailable",
    objectivesInstruction(state),
    promptAceContext(options),
    boundedResearchDelegationInstruction(),
    "Then implement or investigate using any Pi tools that are useful only after the user-confirmed acceptance criteria exist and the current plan has trackable tasks.",
    "Keep this attempt short: complete a verifiable slice within the loop cap and move unfinished tasks or research gaps to the next feedback attempt.",
    "During acceptance discovery, do not call loop_feedback after each question or partial user answer. Keep asking focused questions in this same turn until the user explicitly confirms criteria and you can record a trackable planTasks list; then call loop_feedback once with acceptanceStatus: \"confirmed\", acceptanceCriteria, and planTasks. Do not put verification matrices, design rubrics, Rails safety, artifacts, or audit dumps in the feedback tool; run that work during the loop or final refinement instead.",
    "Do not claim completion without recording feedback.",
    scoringRubricSummary(),
  ].join("\n\n");
}

export function continuePrompt(state: LoopRuntimeState, options: LoopPromptOptions = {}): string {
  if (!acceptanceReady(state)) return acceptancePlanningPrompt(state, options);
  if (completionClaimed(state)) return confirmationPassPrompt(state, options);

  const last = state.results[state.results.length - 1];
  const scoreLine = last ? `Last progress: ${formatProgress(last.progressPercent ?? null)}.` : "No baseline has been recorded yet; the first loop_feedback call records it.";
  const nextActions = last?.nextActions.length ? `Next actions from feedback scorer:\n${refineNextActions(last.nextActions).map((action) => `- ${action}`).join("\n")}` : "Next action: produce concrete evidence and record a loop_feedback checkpoint.";
  const blockers = last?.blockers.length ? `Blockers from feedback scorer:\n${last.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.message}`).join("\n")}` : "Blockers from feedback scorer: none";

  return [
    "Continue the pi-loop workflow with a refined prompt, not a passive retry.",
    `Goal: ${state.goal ?? ""}`,
    scoreLine,
    objectivesInstruction(state),
    refinementObservation(state),
    formatFeedbackHistory(state),
    planStateForPrompt(state),
    promptAceContext(options),
    blockers,
    reviewGateGuidance(state),
    nextActions,
    planGuidedNextPromptInstruction(state),
    `Budget: ${runBudgetText(state)}.`,
    boundedResearchDelegationInstruction(),
    "Strategy rule: use ACE context and feedback-scoring output to choose a different, verifiable slice. Do not repeat the same plan, evidence, or checks unless you explain why reuse is necessary.",
    "Progress is feedback only; verify one slice, record loop_feedback, and carry unfinished work or partial research into the next feedback attempt.",
    "At the end of this turn, call loop_feedback with a focused summary/status/notes checkpoint plus acceptanceStatus, acceptanceCriteria, and planTasks when available. Keep hardening, verification, and audit work in normal loop actions or final refinement, not in the feedback tool input.",
  ].join("\n\n");
}

function confirmationPassPrompt(state: LoopRuntimeState, options: LoopPromptOptions = {}): string {
  const last = state.results.at(-1);
  const criteria = last?.attempt?.acceptanceCriteria?.filter(Boolean) ?? [];
  const pass = confirmationPassCount(state);
  return [
    `Completion has been claimed for this loop. This turn is confirmation pass #${pass}: independently re-verify the claim instead of starting new work.`,
    `Goal: ${state.goal ?? ""}`,
    criteria.length ? ["Acceptance criteria to re-verify one by one:", ...criteria.map((criterion, index) => `- AC${index + 1}: ${criterion}`)].join("\n") : "Acceptance criteria to re-verify: recover them from the confirmed plan in the feedback history.",
    objectivesInstruction(state),
    formatFeedbackHistory(state),
    promptAceContext(options),
    [
      "Confirmation rules:",
      "- Produce fresh evidence this turn for every criterion: re-run the real checks, exercise the result end-to-end the way the user would, and actively try to falsify the claim (edge cases, clean state, missed criteria, stale artifacts).",
      "- Do not add features, refactors, or new scope during a confirmation pass.",
      "- If every criterion holds with fresh evidence, call loop_feedback with status ready_for_review, keep all planTasks completed, and put the per-criterion evidence in the task evidence fields.",
      "- If any criterion fails or its evidence is stale, reopen the relevant planTasks (pending or in_progress), call loop_feedback with status continue, and fix the gap in the following turns.",
      "- When delegation tooling is available, run at least one confirmation as an independent audit lane: spawn a read-only agent with the acceptance criteria, the exact artifacts to inspect, and a report deadline inside the loop cap; treat its report as review evidence and do lead-owned falsification in parallel. If no delegation tooling exists, do the independent re-verification yourself from a clean state.",
      pass >= 2 ? "- This claim has already survived at least one confirmation pass. Vary the angle: verify in a cleaner environment, as a different user path, or against the criteria most likely to hide a gap." : undefined,
    ].filter(Boolean).join("\n"),
    `Budget: ${runBudgetText(state)}.`,
  ].join("\n\n");
}

function acceptancePlanningPrompt(state: LoopRuntimeState, options: LoopPromptOptions = {}): string {
  const last = state.results[state.results.length - 1];
  const nextActions = last?.nextActions.length ? `Next actions from acceptance scorer:\n${refineNextActions(last.nextActions).map((action) => `- ${action}`).join("\n")}` : "Next action: make acceptance criteria clear, confirmed, and trackable before starting agent work.";
  return [
    "Continue the mandatory acceptance-planning step. Do not start normal agent work yet.",
    `Goal: ${state.goal ?? ""}`,
    planStateForPrompt(state),
    promptAceContext(options),
    last?.blockers.length ? `Acceptance blockers:\n${last.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.message}`).join("\n")}` : "Acceptance blockers: acceptance criteria are not ready for normal work yet.",
    nextActions,
    "Hard gate: no implementation, testing loop, progress optimization, or arbitrary next-turn selection starts until acceptanceStatus is confirmed and acceptanceCriteria plus planTasks are recorded.",
    "If user input is needed, ask only acceptance-planning questions. If research is needed, use bounded research to produce candidate criteria/options for user confirmation.",
    "Do not call loop_feedback for missing, discovering, or proposed criteria just because the user answered one question. Keep using ask_user or bounded research in this same turn until the user explicitly confirms clear criteria and you can record concrete planTasks. Then call loop_feedback once with acceptanceStatus: \"confirmed\", acceptanceCriteria, and planTasks. If you are truly blocked and cannot ask/research further, report the blocker in prose instead of scoring the discovery turn.",
  ].join("\n\n");
}

export function missingScorePrompt(state: LoopRuntimeState, claimedCompletion = false): string {
  return [
    claimedCompletion ? "The previous turn claimed completion without calling loop_feedback." : "The previous pi-loop turn ended without calling loop_feedback.",
    "Do not do more implementation work before recording feedback for the current state.",
    `Goal: ${state.goal ?? ""}`,
    `Budget: ${runBudgetText(state)}.`,
    "If spawned agents or data collection are involved, do not treat delegation itself as evidence: use completed reports, concrete partial findings, or an honest missing-evidence note only.",
    "Call loop_feedback now with a focused summary/status/notes checkpoint plus acceptanceStatus, acceptanceCriteria, and planTasks when available. Do not expand it into a verification report; missing checks belong in notes or next actions for the next/refinement step.",
  ].join("\n\n");
}

export function delegationPendingPrompt(state: LoopRuntimeState): string {
  return [
    "Delegation is in progress for pi-loop; a spawn-only turn is not scoreable progress.",
    `Goal: ${state.goal ?? ""}`,
    `Budget: ${runBudgetText(state)}.`,
    "Wait for focused agent reports instead of forcing a score. If there is independent lead-owned work that does not duplicate agent scope, do that in the next user/extension wake-up; otherwise let the team report first.",
    "When reports arrive, synthesize the evidence, verify one concrete slice, then call loop_feedback with a focused checkpoint plus acceptanceStatus, acceptanceCriteria, and planTasks when available. Near the loop cap, request partial reports and list missing pieces as next actions.",
  ].join("\n\n");
}

export function nextRunPrompt(state: LoopRuntimeState, options: LoopPromptOptions = {}): string {
  if (completionClaimed(state)) {
    return [
      "Start the next pi-loop run as an independent confirmation audit: the previous run claimed completion, so assume nothing from it.",
      `Goal: ${state.goal ?? ""}`,
      "Audit rules: re-verify every confirmed acceptance criterion with fresh evidence produced in this run, exercise the result end-to-end as the user would, and try to falsify the claim before doing any new work. If a criterion fails, reopen its planTasks and fix it; if everything holds, record loop_feedback with status ready_for_review and the fresh per-criterion evidence.",
      formatFeedbackHistory(state),
      planStateForPrompt(state),
      promptAceContext(options),
      `Budget: ${runBudgetText(state)}.`,
    ].join("\n\n");
  }
  return [
    "Start the next pi-loop run for the same goal with a refined strategy.",
    `Goal: ${state.goal ?? ""}`,
    refinementObservation(state),
    `Budget: ${runBudgetText(state)}.`,
    formatFeedbackHistory(state),
    planStateForPrompt(state),
    promptAceContext(options),
    reviewGateGuidance(state),
    boundedResearchDelegationInstruction(),
    "Use ACE context plus prior feedback to choose a genuinely different short plan. Call loop_feedback at the end of the turn with only a focused summary/status/notes checkpoint plus acceptanceStatus, acceptanceCriteria, and planTasks when available.",
  ].join("\n\n");
}

export function systemPromptAddon(state: LoopRuntimeState): string {
  return [
    "## pi-loop mode active",
    `Goal: ${state.goal ?? ""}`,
    `Limits: ${state.maxMinutes} minutes, ${state.maxTurns} turns per run, and ${state.maxRuns} run(s). Defaults are 10 minutes, 12 turns, and 1 run unless the user configured otherwise; minutes are capped at 10.`,
    state.targetContext ? formatTargetContext(state.targetContext) : "Target context snapshot: unavailable",
    objectivesInstruction(state),
    acceptanceInstructionForCurrentState(state),
    state.results.length > 0 ? planStateForPrompt(state) : undefined,
    boundedResearchDelegationInstruction(),
    "A loop turn starts when the agent begins work and ends when it records a focused loop_feedback checkpoint. The extension treats the first feedback turn as a hidden baseline and keeps using feedback until a configured limit or user stop is reached.",
    completionClaimed(state) ? "A completion claim is currently under confirmation: this turn must re-verify the confirmed acceptance criteria with fresh evidence instead of adding scope. Reopen planTasks if any criterion fails." : undefined,
    "You may use any active Pi tools needed to solve the goal. The extension does not sandbox your tool choices, so be disciplined and produce evidence.",
    "You must call loop_feedback before presenting a completion claim.",
    "Keep loop_feedback focused. Before acceptance is confirmed, do not call it for missing/discovering/proposed criteria or partial ask_user answers. After the gate is open, use acceptanceStatus, acceptanceCriteria, and planTasks for compact loop state, not as a massive verification, artifact, design, Rails, or audit report; those checks happen during normal work or final refinement.",
    "Hard rules for the work itself: map requirements, use real passed checks when changing executable code, assert observable behavior, do not use mock-only or implementation-coupled tests, do not mock owned code, keep responsibilities split, avoid god files, and apply framework-specific safety when Rails or similar framework code is involved.",
    "Loop pacing: finish a verifiable slice within the 10-minute cap; spawned agents and data collection are useful but stay inside that cap, with partial results carried to the next feedback attempt.",
    scoringRubricSummary(),
  ].join("\n");
}

function acceptanceCriteriaGateInstruction(): string {
  return [
    "First /goal step: run acceptance discovery before implementation.",
    "- The agent must decide whether acceptance criteria are present, user-confirmed, and sufficient for a plan. Do not rely on command parsing or treat bullets in the prompt as automatically enough.",
    "- User-provided acceptance bullets are strong signals, but the agent may still say they are insufficient, ambiguous, too high-level, or missing critical context; then mark acceptanceStatus as proposed/discovering and ask or research before planning.",
    "- Do not treat agent-invented criteria as final. Candidate criteria from the agent or spawned research must go back to the user for selection, editing, or rejection.",
    "- If the goal is vague, ask contextual discovery questions instead of asking generically for 'acceptance criteria'. Example: for '/goal lets build a house', ask whether the user owns land, starts from zero or renovation, needs foundation/plans/permits/appliances, budget/timeline/location constraints, and what outcome this Goal should produce.",
    "- If the user says they do not know, use bounded research/delegation to bring back candidate paths, tradeoffs, and candidate acceptance criteria for the user to select, edit, or reject.",
    "- Only after the agent judges the user-confirmed criteria sufficient, build or update a trackable plan with task statuses (pending, in_progress, completed, blocked).",
    "- Do not call loop_feedback after every discovery question or partial answer. Use loop_feedback only once acceptanceStatus is confirmed with acceptanceCriteria and planTasks, or later during normal work after the acceptance gate is open.",
  ].join("\n");
}

function planStateForPrompt(state: LoopRuntimeState): string {
  const lastAttempt = state.results.at(-1)?.attempt;
  const acceptanceStatus = lastAttempt?.acceptanceStatus ?? "missing";
  const criteria = lastAttempt?.acceptanceCriteria?.filter(Boolean) ?? [];
  const tasks = lastAttempt?.planTasks?.filter((task) => task.title?.trim()) ?? [];

  if (acceptanceReady(state) && state.results[0]?.attempt?.acceptanceStatus === undefined && acceptanceStatus !== "confirmed") {
    return [
      "Acceptance/plan state:",
      "- Acceptance gate is open from legacy pre-upgrade feedback history; no structured acceptance metadata was recorded in that older log.",
      "- Continue normal loop work from the prior feedback instead of restarting acceptance discovery.",
    ].join("\n");
  }

  if (criteria.length === 0 && tasks.length === 0) {
    return [
      "Acceptance/plan state:",
      "- Acceptance status: missing.",
      "- No user-confirmed acceptance criteria or trackable plan tasks were recorded yet.",
      "- First action: run acceptance discovery. Ask contextual questions or research candidate options; do not build the implementation plan until the user confirms criteria.",
    ].join("\n");
  }

  return [
    "Acceptance/plan state:",
    `- Acceptance status: ${acceptanceStatus}.`,
    ...(criteria.length ? ["Acceptance criteria or candidates:", ...criteria.map((criterion, index) => `- AC${index + 1}: ${criterion}`)] : ["- Acceptance criteria still missing; discover them with the user before implementation."]),
    ...(acceptanceStatus === "confirmed" && tasks.length ? ["Trackable tasks:", ...tasks.map((task) => `- ${task.id ? `${task.id}: ` : ""}${task.title} [${task.status}]${task.evidence ? ` — ${task.evidence}` : ""}`)] : acceptanceStatus === "confirmed" ? ["- Trackable tasks still missing; build the plan from confirmed criteria before implementation."] : ["- Trackable tasks are intentionally deferred until the user confirms acceptance criteria."]),
  ].join("\n");
}

function planGuidedNextPromptInstruction(state: LoopRuntimeState): string {
  if (acceptanceIsConfirmed(state)) {
    return "Plan-guided next prompt rule: acceptance criteria are already confirmed. Do not re-run acceptance discovery or ask the user to choose the next turn unless a new blocker truly requires input. Continue the next in_progress, blocked, or pending plan task and update planTasks statuses in loop_feedback.";
  }
  return "Plan-guided next prompt rule: if acceptanceStatus is missing/discovering/proposed, the next prompt must ask contextual questions, research options, or ask the user to select/confirm criteria before agentic implementation starts.";
}

function acceptanceInstructionForCurrentState(state: LoopRuntimeState): string {
  if (!acceptanceIsConfirmed(state)) return acceptanceCriteriaGateInstruction();
  return "Acceptance criteria are already confirmed for this loop. Do not repeat the acceptance-discovery step and do not ask the user to reconfirm or choose the next turn unless a new blocker makes input necessary. Continue the approved plan with normal agentic work and update planTasks through loop_feedback.";
}

function acceptanceIsConfirmed(state: LoopRuntimeState): boolean {
  return acceptanceReady(state);
}

function objectivesInstruction(state: LoopRuntimeState): string | undefined {
  const objectives = state.targetContext?.objectives ?? [];
  if (objectives.length === 0) return undefined;
  const missing = unreportedObjectives(objectives, state.results);
  const lines = [
    "Measurable objectives parsed from the goal:",
    formatNumericObjectives(objectives),
    "Objective measurement rule: every reported number must come from a real command run this turn. Measure a baseline for each objective in the first work turn after acceptance is confirmed, then report the current value for each objective in loop_feedback metrics (use the objective id, e.g. O1, as the metric name). Real measured deltas against these objectives are the primary progress signal.",
  ];
  if (state.results.length > 0 && missing.length > 0) {
    lines.push(`Objectives still missing a measured baseline: ${missing.map((objective) => objective.id).join(", ")}. Measure them with real commands before more implementation.`);
  }
  return lines.join("\n");
}

function promptAceContext(options: LoopPromptOptions): string | undefined {
  return options.aceContext?.trim() ? options.aceContext.trim() : undefined;
}

function boundedResearchDelegationInstruction(): string {
  return "Bounded research/delegation rule: spawned research agents are allowed and valuable when they can return useful evidence inside the loop cap, but delegation itself is not progress evidence. Keep the lead responsible for decomposition, synthesis, verification, and loop_feedback. When independent questions exist, prefer several small read-only research/review lanes over one broad \"do the whole goal\" agent; each spawned agent needs a narrow question, concrete files or search targets, a report shape, and an explicit report deadline before timeout, ideally under 10 minutes. pi-loop cannot interrupt child agents for you: do independent lead-owned work while they run when possible, otherwise wait for reports instead of forcing a feedback checkpoint. Near the cap, request final or partial reports, record a focused loop_feedback checkpoint, list missing pieces as nextActions, and move unfinished research into the next feedback attempt.";
}

function reviewGateGuidance(state: LoopRuntimeState): string | undefined {
  const last = state.results.at(-1);
  if (!last) return undefined;

  const reviewCategory = last.categories.find((category) => category.key === "reviewGates");
  const reviewBlockers = last.blockers.filter((blocker) => /review gate|automated review|required gate|merge-blocking|\bCI\b/i.test(blocker.message));
  const reviewGaps = (reviewCategory?.gaps ?? []).filter(Boolean);
  const needsGuidance = last.outcome === "review_gate_failed" || reviewBlockers.length > 0 || (reviewCategory !== undefined && reviewCategory.score < reviewCategory.max);
  if (!needsGuidance) return undefined;

  const evidenceLines = [...reviewBlockers.slice(0, 2).map((blocker) => `- Gate blocker: ${blocker.message}`), ...reviewGaps.slice(0, 3).map((gap) => `- Gate gap: ${gap}`)];
  return [
    "Review gate recovery:",
    ...evidenceLines,
    "- Before more implementation, either run or obtain a passed CI, required, or merge-blocking review gate for executable changes, or record the missing gate as an unresolved feedback blocker.",
    "- If review evidence needs another agent, delegate a bounded read-only review lane with the failed or missing gate, exact files/checks, and an explicit report deadline before the loop cap.",
  ].join("\n");
}

function refinementObservation(state: LoopRuntimeState): string {
  const last = state.results.at(-1);
  if (!last) return "Refined observation: no feedback attempt yet. First loop_feedback call establishes the baseline.";
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
    entry.hypothesis ? `Previous hypothesis: ${entry.hypothesis}${entry.verdict ? ` (verdict: ${entry.verdict})` : ""}` : undefined,
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
  if (!signals.length) signals.push("No feedback-scorer blockers were reported, so improve by adding stronger evidence, broader checks, or a different implementation strategy rather than repeating the same proof.");
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
    "- The next feedback checkpoint must show new evidence or explain the blocker; repeated progress is not acceptance.",
    ...(actions.length ? ["Feedback-scorer suggested directions:", ...actions] : []),
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
