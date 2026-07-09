import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message, TextContent } from "@earendil-works/pi-ai";

import { appendLogEntry } from "./log.ts";
import type { LoopController } from "./controller.ts";
import { refineNextActions } from "./feedback-refinement.ts";
import { formatMetricFeedback, verifyMetrics } from "./metric-feedback.ts";
import { canonicalizeMetrics, normalizeMetrics, type MeasuredMetric } from "./objectives.ts";
import { formatProgressPercent } from "./progress.ts";
import { scoreLoopResult, type AcceptanceStatus, type LoopPlanTaskEvidence, type LoopScoreInput } from "./scoring-heuristics.ts";
import { acceptanceReady, baselineScoreValue, bestScore, pauseLoopTimer, previousScoreValue, scoreEntryFromResult, type LoopRuntimeState } from "./state.ts";
import { sendLoopStepMessage } from "./step-message.ts";
import { LoopFeedbackParams } from "./tool-schema.ts";
import { updateLoopWidget } from "./ui.ts";

type FeedbackStatus = "continue" | "blocked" | "ready_for_review";

interface LoopFeedbackInput {
  summary?: string;
  status?: FeedbackStatus;
  notes?: string;
  acceptanceStatus?: AcceptanceStatus;
  acceptanceCriteria?: string[];
  planTasks?: LoopPlanTaskEvidence[];
  metrics?: MeasuredMetric[];
  hypothesis?: string;
  verdict?: "keep" | "discard";
  nextActions?: string[];
}

interface ObservedCheck {
  name: string;
  status: "passed" | "failed";
  kind: "test" | "typecheck" | "build" | "security" | "dependency_audit" | "review";
  command?: string;
  exitCode?: number;
  evidence: string;
}

export function registerScoreTool(pi: ExtensionAPI, controller: LoopController): void {
  pi.registerTool({
    name: controller.scoreToolName,
    label: "Record Loop Feedback",
    description: "Record a focused pi-loop feedback checkpoint. The tool scores from the turn state and transcript; do not restate full verification evidence.",
    promptSnippet: "Call loop_feedback only after acceptance is confirmed with planTasks, then at the end of each normal pi-loop work turn.",
    promptGuidelines: [
      "Do not call loop_feedback for partial acceptance discovery, missing criteria, proposed criteria, or each ask_user answer.",
      "Before normal work starts, use loop_feedback exactly once only when the user-confirmed acceptanceCriteria and trackable planTasks are ready.",
      "After acceptance is confirmed, use loop_feedback at the end of every normal pi-loop work turn before claiming completion.",
      "Keep the tool input focused: summary, status, notes, acceptanceStatus, acceptanceCriteria, planTasks, optionally metrics, and optionally short next actions.",
      "When the loop has numeric objectives (O1, O2, ...), report each measured value in metrics using the objective id as the name. Only report numbers produced by real commands this turn.",
      "Record a one-line hypothesis for what this turn tested and a verdict (keep or discard) for whether the attempt should survive, so experiments stay comparable across turns.",
      "Do not put artifacts, test matrices, design rubrics, Rails safety, audit details, or long verification evidence in this tool. Run that work during the loop or final refinement instead.",
    ],
    parameters: LoopFeedbackParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = controller.getState(ctx);
      if (!state.goal) {
        return { content: [{ type: "text", text: "No intelligent Goal is active. Start one with /goal <objective>." }], details: {} };
      }

      const feedback = params as LoopFeedbackInput;
      const gateAlreadyOpen = acceptanceReady(state);
      const opensAcceptanceGate = !gateAlreadyOpen && feedbackConfirmsAcceptance(feedback);
      if (!gateAlreadyOpen && !opensAcceptanceGate) {
        return {
          content: [{ type: "text", text: acceptanceDiscoveryNotScoreableMessage(feedback) }],
          details: { acceptanceGate: "not_ready" },
          terminate: false,
        };
      }

      recordFeedbackTurnDuration(state);
      pauseLoopTimer(state);
      controller.cancelPendingResume(state);

      const observations = observeTurnChecks(ctx, state);
      const scoreInput = buildFeedbackScoreInput(state, feedback, observations);
      const result = scoreLoopResult({
        ...scoreInput,
        previousScore: previousScoreValue(state),
        bestScore: bestScore(state)?.score ?? null,
        priorAttemptPlans: priorAttemptPlans(state),
        baselineScore: baselineScoreValue(state),
        targetScore: state.targetScore,
      }, undefined, { cwd: ctx.cwd });
      const nextActions = nextActionsForFeedback(feedback, scoreInput, result.nextActions);
      const objectives = state.targetContext?.objectives ?? [];
      const metrics = canonicalizeMetrics(objectives, verifyMetrics(normalizeMetrics(feedback.metrics), observations));
      const metricLines = formatMetricFeedback(objectives, state.results, metrics);
      const feedbackTurn = state.pendingFeedbackTurn ?? { run: state.currentRun, turn: Math.max(1, state.turnsStarted), globalTurn: Math.max(1, state.totalTurnsStarted) };
      const entry = scoreEntryFromResult(feedbackTurn.turn, scoreInput.summary, { ...result, nextActions }, scoreInput.attempt, feedbackTurn.run, feedbackTurn.globalTurn, {
        metrics,
        hypothesis: feedback.hypothesis?.replace(/\s+/g, " ").trim().slice(0, 300) || undefined,
        verdict: feedback.verdict === "keep" || feedback.verdict === "discard" ? feedback.verdict : undefined,
      });
      state.results.push(entry);
      state.unscoredConsecutiveTurns = 0;
      state.pendingFeedbackTurn = null;
      appendLogEntry(ctx.cwd, entry);
      updateAfterScore(ctx, state);
      sendLoopStepMessage(pi, state, opensAcceptanceGate ? "acceptance confirmed" : "feedback", opensAcceptanceGate ? "criteria confirmed with trackable plan" : formatProgressPercent(result.progressPercent), ctx.cwd);

      return {
        content: [{ type: "text", text: opensAcceptanceGate ? formatAcceptanceConfirmationResponse(scoreInput) : formatScoreResponse({ ...result, nextActions }, metricLines) }],
        details: { result: { ...result, nextActions }, loopState: loopStateDetails(state) },
        terminate: true,
      };
    },
  });
}

function feedbackConfirmsAcceptance(feedback: LoopFeedbackInput): boolean {
  return feedback.acceptanceStatus === "confirmed" && normalizeAcceptanceCriteria(feedback.acceptanceCriteria).length > 0 && normalizePlanTasks(feedback.planTasks).length > 0;
}

function acceptanceDiscoveryNotScoreableMessage(feedback: LoopFeedbackInput): string {
  const status = feedback.acceptanceStatus ?? "missing";
  return [
    "Acceptance discovery is not a loop_feedback checkpoint yet.",
    `Current acceptanceStatus: ${status}.`,
    "Do not score partial discovery or each ask_user answer. Keep asking focused acceptance-planning questions, or use bounded research, until the user explicitly confirms clear acceptance criteria and you can record concrete planTasks.",
    "When that is ready, call loop_feedback once with acceptanceStatus: \"confirmed\", acceptanceCriteria, and planTasks.",
  ].join("\n");
}

function formatAcceptanceConfirmationResponse(scoreInput: LoopScoreInput): string {
  const criteriaCount = scoreInput.attempt?.acceptanceCriteria?.length ?? 0;
  const taskCount = scoreInput.attempt?.planTasks?.length ?? 0;
  return [
    "Acceptance planning recorded.",
    `Confirmed acceptance criteria: ${criteriaCount}.`,
    `Trackable plan tasks: ${taskCount}.`,
    "The acceptance gate is open; continue with the first normal implementation/research task next.",
  ].join("\n");
}

function updateAfterScore(ctx: ExtensionContext, state: LoopRuntimeState): void {
  updateLoopWidget(ctx, state);
}

function recordFeedbackTurnDuration(state: LoopRuntimeState): void {
  if (state.currentTurnStartedAt === null) return;
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - state.currentTurnStartedAt);
  state.lastTurnDurationMs = durationMs;
  state.turnDurations = [
    ...state.turnDurations.filter((entry) => entry.globalTurn !== state.totalTurnsStarted),
    {
      run: state.currentRun,
      turn: state.turnsStarted,
      globalTurn: state.totalTurnsStarted,
      startedAt: state.currentTurnStartedAt,
      endedAt,
      durationMs,
    },
  ].slice(-20);
  state.currentTurnStartedAt = null;
}

function buildFeedbackScoreInput(state: LoopRuntimeState, feedback: LoopFeedbackInput, observations: ObservedCheck[]): LoopScoreInput {
  const status = feedback.status ?? "continue";
  const artifacts = artifactsFromTargetContext(state);
  const summary = feedback.summary?.trim() || feedback.notes?.trim() || `Loop feedback recorded: ${status}.`;
  const priorAttempt = state.results.at(-1)?.attempt;
  const criteriaInput = feedback.acceptanceCriteria ?? priorAttempt?.acceptanceCriteria;
  const legacyAcceptanceOpen = state.results[0]?.attempt?.acceptanceStatus === undefined && acceptanceReady(state) && feedback.acceptanceStatus === undefined && feedback.acceptanceCriteria === undefined && feedback.planTasks === undefined;
  const acceptanceStatus = legacyAcceptanceOpen ? undefined : normalizeAcceptanceStatus(feedback.acceptanceStatus ?? priorAttempt?.acceptanceStatus, criteriaInput);
  const acceptanceCriteria = legacyAcceptanceOpen ? [] : normalizeAcceptanceCriteria(criteriaInput);
  const planTasks = legacyAcceptanceOpen ? [] : normalizePlanTasks(feedback.planTasks ?? priorAttempt?.planTasks);
  const checks = observations.map((check) => ({ ...check, required: check.kind !== "review", scope: "targeted" as const }));
  const passedTests = checks.filter((check) => check.status === "passed" && check.kind === "test");
  const testEvidenceFiles = passedTests.map((check) => check.command ?? check.name);
  const failedRequired = checks.filter((check) => check.status === "failed" && check.required);
  const blocked = status === "blocked" || failedRequired.length > 0;
  const ready = status === "ready_for_review";

  return {
    goal: state.goal ?? "",
    summary,
    domain: { softwareProject: softwareProjectDomain(state) },
    artifacts,
    requirements: legacyAcceptanceOpen ? legacyOpenRequirements({ blocked, ready, evidence: feedback.notes ?? summary }) : requirementsFromAcceptanceCriteria(acceptanceStatus ?? "missing", acceptanceCriteria, planTasks, { blocked, ready, evidence: feedback.notes ?? summary }),
    checks,
    tests: passedTests.length ? {
      files: testEvidenceFiles,
      behaviorsCovered: ["turn feedback"],
      regressionCovered: true,
      observableAssertions: true,
      assertionsExerciseBehavior: true,
      wouldFailOnBug: true,
      changedCodeCovered: true,
      integrationOrSystemCovered: true,
      usesMocksForOwnedCode: false,
      mockOnly: false,
      hasSleeps: false,
      flaky: false,
      implementationCoupled: false,
      commandEvidence: passedTests.map((check) => check.evidence).join("; "),
    } : undefined,
    design: {
      responsibilitiesSplit: !blocked,
      smallFiles: !blocked,
      solid: !blocked,
      noGodFiles: !blocked,
      boundariesClear: !blocked,
      singleResponsibility: !blocked,
      lowCouplingHighCohesion: !blocked,
      complexityControlled: !blocked,
      evidence: "Feedback tool no longer asks the model to restate design evidence; design hardening happens during loop work and final refinement.",
    },
    rails: railsEvidenceFromArtifacts(artifacts),
    process: {
      commandsRun: checks.map((check) => check.command).filter((command): command is string => Boolean(command)),
      finalOutcome: summary,
      evidence: feedback.notes,
    },
    operability: {
      limitsDefined: true,
      persistenceDefined: true,
      loggingAvailable: true,
      rollbackOrRecoveryDefined: true,
      humanStopAvailable: true,
      evidence: "Feedback checkpoint persisted to pi-loop log; detailed hardening remains normal loop/final-refinement work.",
    },
    reviewGates: checks.filter((check) => check.kind === "security" || check.kind === "dependency_audit").map((check) => ({ ...check, required: true, blocksMerge: check.status === "passed" })),
    risks: blocked ? [{ severity: "blocker", description: feedback.notes ?? "Loop turn reported blocked feedback.", resolved: false, kind: "operability" }] : [],
    attempt: {
      rationale: feedback.notes?.trim() || summary,
      fullPlan: summarizePlanTasks(planTasks) || summarizeCurrentPrompt(state) || summary,
      actionsTaken: observations.map((check) => check.name),
      ...(legacyAcceptanceOpen ? {} : { acceptanceStatus, acceptanceCriteria, planTasks }),
      stopIntent: status === "blocked" ? "blocked" : ready ? "claim_done" : "continue",
      reusedPriorPlan: false,
    },
  };
}

function normalizeAcceptanceStatus(status: AcceptanceStatus | undefined, criteria: string[] | undefined): AcceptanceStatus {
  if (status) return status;
  return criteria?.length ? "proposed" : "missing";
}

function normalizeAcceptanceCriteria(criteria: string[] | undefined): string[] {
  return uniqueTrimmed(criteria ?? []);
}

function normalizePlanTasks(tasks: LoopPlanTaskEvidence[] | undefined): LoopPlanTaskEvidence[] {
  return (tasks ?? [])
    .map((task) => ({
      id: cleanOptionalText(task.id),
      title: cleanRequiredText(task.title),
      status: task.status,
      evidence: cleanOptionalText(task.evidence),
    }))
    .filter((task) => task.title.length > 0 && ["pending", "in_progress", "completed", "blocked"].includes(task.status));
}

function legacyOpenRequirements(options: { blocked: boolean; ready: boolean; evidence: string }): NonNullable<LoopScoreInput["requirements"]> {
  return [{
    description: "Legacy loop feedback remains scoreable without restarting acceptance discovery.",
    status: options.blocked ? "partial" : options.ready ? "met" : "partial",
    evidence: options.evidence,
  }];
}

function requirementsFromAcceptanceCriteria(status: AcceptanceStatus, criteria: string[], tasks: LoopPlanTaskEvidence[], options: { blocked: boolean; ready: boolean; evidence: string }): NonNullable<LoopScoreInput["requirements"]> {
  if (criteria.length === 0) {
    return [{
      id: "AC1",
      description: "Discover acceptance criteria with the user before implementation work continues.",
      status: "unknown",
      critical: true,
      evidence: "No acceptanceCriteria values were recorded in loop_feedback.",
    }];
  }

  if (status !== "confirmed") {
    return criteria.map((criterion, index) => ({
      id: `AC${index + 1}`,
      description: criterion,
      status: "unknown",
      critical: true,
      evidence: `Acceptance criteria are ${status}; user confirmation is still required before planning or implementation.`,
    }));
  }

  if (tasks.length === 0) {
    return criteria.map((criterion, index) => ({
      id: `AC${index + 1}`,
      description: criterion,
      status: "partial",
      critical: true,
      evidence: "Acceptance criteria are confirmed, but no trackable planTasks were recorded yet.",
    }));
  }

  const allTasksComplete = tasks.every((task) => task.status === "completed");
  const requirementStatus = options.ready && allTasksComplete ? "met" : options.blocked ? "partial" : "partial";
  return criteria.map((criterion, index) => ({
    id: `AC${index + 1}`,
    description: criterion,
    status: requirementStatus,
    evidence: options.evidence,
  }));
}

function summarizePlanTasks(tasks: LoopPlanTaskEvidence[]): string | undefined {
  if (tasks.length === 0) return undefined;
  return tasks.map((task) => `${task.id ? `${task.id}: ` : ""}${task.title} [${task.status}]${task.evidence ? ` — ${task.evidence}` : ""}`).join("; ");
}

function nextActionsForFeedback(feedback: LoopFeedbackInput, scoreInput: LoopScoreInput, fallback: string[]): string[] {
  const hasStructuredAcceptance = scoreInput.attempt?.acceptanceStatus !== undefined || (scoreInput.attempt?.acceptanceCriteria?.length ?? 0) > 0 || (scoreInput.attempt?.planTasks?.length ?? 0) > 0;
  const acceptanceStatus = scoreInput.attempt?.acceptanceStatus ?? "missing";
  const acceptanceCriteria = scoreInput.attempt?.acceptanceCriteria ?? [];
  const planTasks = scoreInput.attempt?.planTasks ?? [];
  const planActions = hasStructuredAcceptance ? nextActionsFromPlanState(acceptanceStatus, acceptanceCriteria, planTasks) : [];
  const explicitActions = feedback.nextActions?.length ? feedback.nextActions : [];
  const actions = explicitActions.length ? [...explicitActions, ...planActions] : [...planActions, ...fallback];
  return refineNextActions(actions);
}

function nextActionsFromPlanState(status: AcceptanceStatus, criteria: string[], tasks: LoopPlanTaskEvidence[]): string[] {
  const actions: string[] = [];
  if (status === "missing") actions.push("Ask contextual discovery questions to uncover acceptance criteria before implementation continues.");
  if (status === "discovering") actions.push("Use bounded research or user discovery to produce candidate acceptance criteria for the user to choose from.");
  if (status === "proposed" || (status !== "confirmed" && criteria.length > 0)) actions.push("Ask the user to select, adjust, or confirm the proposed acceptance criteria before building the implementation plan.");
  if (status !== "confirmed") return actions;
  if (tasks.length === 0) actions.push("Build a trackable task plan from the confirmed acceptance criteria before the next implementation slice.");
  const blockedTask = tasks.find((task) => task.status === "blocked");
  if (blockedTask) actions.push(`Unblock plan task${blockedTask.id ? ` ${blockedTask.id}` : ""}: ${blockedTask.title}.`);
  const activeTask = tasks.find((task) => task.status === "in_progress");
  if (activeTask) actions.push(`Finish current plan task${activeTask.id ? ` ${activeTask.id}` : ""}: ${activeTask.title}.`);
  const pendingTask = tasks.find((task) => task.status === "pending");
  if (!activeTask && pendingTask) actions.push(`Start next plan task${pendingTask.id ? ` ${pendingTask.id}` : ""}: ${pendingTask.title}.`);
  if (tasks.length > 0 && tasks.every((task) => task.status === "completed")) actions.push("All recorded plan tasks are completed; verify the confirmed acceptance criteria or define the next plan slice.");
  return actions;
}

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanRequiredText(value);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function cleanRequiredText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const text = cleanRequiredText(value);
  return text || undefined;
}

function softwareProjectDomain(state: LoopRuntimeState): boolean {
  const context = state.targetContext;
  if (!context) return true;
  const packageManagerKnown = context.baseline.packageManager !== undefined && context.baseline.packageManager !== "unknown";
  const hasScripts = (context.baseline.scripts?.length ?? 0) > 0;
  const hasCodeFiles = context.files.some((file) => file.exists && file.kind !== "docs");
  return packageManagerKnown || hasScripts || hasCodeFiles || context.checks.length > 0;
}

function artifactsFromTargetContext(state: LoopRuntimeState): LoopScoreInput["artifacts"] {
  return (state.targetContext?.files ?? [])
    .filter((file) => file.exists)
    .map((file) => ({
      path: file.path,
      purpose: file.source === "explicit" ? "explicit loop target" : "goal-derived loop target",
      kind: scoreArtifactKind(file.kind),
    }));
}

function scoreArtifactKind(kind: string | undefined): NonNullable<LoopScoreInput["artifacts"]>[number]["kind"] {
  if (kind === "docs" || kind === "config" || kind === "migration" || kind === "script" || kind === "generated" || kind === "test") return kind;
  return "source";
}

function railsEvidenceFromArtifacts(artifacts: LoopScoreInput["artifacts"]): LoopScoreInput["rails"] {
  const paths = artifacts?.map((artifact) => artifact.path) ?? [];
  const railsRelevant = paths.some((path) => /^(app|db|config|lib\/tasks)\//.test(path) || /Gemfile|config\.ru/.test(path));
  if (!railsRelevant) return { relevant: false };
  return {
    relevant: true,
    migrationChanged: paths.some((path) => /(^|\/)db\/migrate\//.test(path)),
    authorizationRelevant: paths.some((path) => /(^|\/)(controllers|policies|graphql|mutations)\//.test(path)),
    evidence: "Rails relevance inferred from target context paths; detailed Rails safety evidence should come from normal work or final refinement.",
  };
}

function observeTurnChecks(ctx: ExtensionContext, state: LoopRuntimeState): ObservedCheck[] {
  const startedAt = state.results.at(-1)?.timestamp ?? state.currentTurnStartedAt ?? 0;
  const entries = ctx.sessionManager.getBranch?.() ?? [];
  const checks: ObservedCheck[] = [];

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const timestamp = Date.parse(entry.timestamp);
    if (startedAt > 0 && Number.isFinite(timestamp) && timestamp < startedAt) continue;
    const message = entry.message as Message;
    if (message.role !== "toolResult") continue;
    const observed = observedCheckFromToolResult(message);
    if (observed) checks.push(observed);
  }

  return dedupeChecks(checks).slice(-8);
}

function observedCheckFromToolResult(message: Extract<Message, { role: "toolResult" }>): ObservedCheck | null {
  const evidence = textContent(message.content).slice(0, 500);
  if (message.toolName === "report_and_exit") {
    return {
      name: "spawned agent report",
      status: message.isError ? "failed" : "passed",
      kind: "review",
      evidence: evidence || (message.isError ? "agent report failed" : "agent report received"),
    };
  }
  if (message.toolName !== "bash") return null;
  const details = (message.details ?? {}) as Record<string, unknown>;
  const command = typeof details.command === "string" ? details.command : inferCommand(evidence);
  const exitCode = typeof details.exitCode === "number" ? details.exitCode : typeof details.code === "number" ? details.code : inferExitCode(evidence, message.isError);
  const kind = classifyCommand(command, evidence);
  return {
    name: command ? command.split(/\s+/).slice(0, 4).join(" ") : `bash ${kind}`,
    status: message.isError || (exitCode !== undefined && exitCode !== 0) ? "failed" : "passed",
    kind,
    command,
    exitCode,
    evidence: evidence || (message.isError ? "tool result failed" : "tool result completed"),
  };
}

function classifyCommand(command: string | undefined, evidence: string): ObservedCheck["kind"] {
  const text = `${command ?? ""}\n${evidence}`.toLowerCase();
  if (/audit|vulnerab|security/.test(text)) return /audit|vulnerab/.test(text) ? "dependency_audit" : "security";
  if (/typecheck|tsc\b/.test(text)) return "typecheck";
  if (/\btest\b|\bcheck\b|node --test|vitest|rspec|minitest/.test(text)) return "test";
  if (/\bbuild\b/.test(text)) return "build";
  return "review";
}

function inferExitCode(evidence: string, isError: boolean): number | undefined {
  const match = evidence.match(/(?:Command exited with code|exit code)\s+(\d+)/i);
  if (match) return Number(match[1]);
  if (/No known vulnerabilities found/i.test(evidence)) return 0;
  return isError ? 1 : 0;
}

function inferCommand(evidence: string): string | undefined {
  const commandLine = evidence.split(/\r?\n/).find((line) => /^> |^\$ /.test(line));
  return commandLine?.replace(/^>\s*|^\$\s*/, "").trim() || undefined;
}

function textContent(content: Extract<Message, { role: "toolResult" }>["content"]): string {
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function dedupeChecks(checks: ObservedCheck[]): ObservedCheck[] {
  const seen = new Set<string>();
  return checks.filter((check) => {
    const key = `${check.command ?? check.name}:${check.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function summarizeCurrentPrompt(state: LoopRuntimeState): string | undefined {
  return state.currentPrompt?.replace(/\s+/g, " ").trim().slice(0, 300) || undefined;
}

function priorAttemptPlans(state: LoopRuntimeState): string[] {
  return state.results.map((entry) => entry.attempt?.fullPlan?.trim()).filter((plan): plan is string => Boolean(plan));
}

export function formatScoreResponse(result: ReturnType<typeof scoreLoopResult>, metricLines: string[] = []): string {
  const blockerLines = result.blockers.length ? result.blockers.map((blocker) => `- ${blocker.severity}: ${blocker.message}`).join("\n") : "none";
  const nextActions = refineNextActions(result.nextActions, "Choose a materially different next action and score again.");
  const nextLines = nextActions.length ? nextActions.map((action) => `- ${action}`).join("\n") : "none";
  const findingLines = result.verifierFindings.length ? result.verifierFindings.map((finding) => `- ${finding.severity}: ${finding.message}`).join("\n") : "none";
  const progress = formatProgressPercent(result.progressPercent);
  const status = result.baselineScore === null ? "baseline recorded; continue" : result.passedDefinition ? "new best recorded; continue" : "continue";

  return [
    `Progress: ${progress} (${status})`,
    `Outcome: ${result.outcome}`,
    ...(metricLines.length ? ["Measured metrics:", metricLines.map((line) => `- ${line}`).join("\n")] : []),
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
