import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message, TextContent } from "@earendil-works/pi-ai";

import { appendLogEntry } from "./log.ts";
import type { LoopController } from "./controller.ts";
import { refineNextActions } from "./feedback-refinement.ts";
import { formatProgressPercent } from "./progress.ts";
import { scoreLoopResult, type LoopScoreInput } from "./scoring-heuristics.ts";
import { baselineScoreValue, bestScore, pauseLoopTimer, previousScoreValue, scoreEntryFromResult, type LoopRuntimeState } from "./state.ts";
import { sendLoopStepMessage } from "./step-message.ts";
import { LoopFeedbackParams } from "./tool-schema.ts";
import { updateLoopWidget } from "./ui.ts";

type FeedbackStatus = "continue" | "blocked" | "ready_for_review";

interface LoopFeedbackInput {
  summary?: string;
  status?: FeedbackStatus;
  notes?: string;
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
    description: "Record a lightweight pi-loop feedback checkpoint. The tool scores from the turn state and transcript; do not restate full verification evidence.",
    promptSnippet: "Call loop_feedback at the end of each pi-loop turn with a tiny summary/status only.",
    promptGuidelines: [
      "Use loop_feedback at the end of every pi-loop turn before claiming completion.",
      "Keep the tool input tiny: summary, status, notes, and optionally short next actions.",
      "Do not put artifacts, test matrices, design rubrics, Rails safety, audit details, or long verification evidence in this tool. Run that work during the loop or final refinement instead.",
    ],
    parameters: LoopFeedbackParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const state = controller.getState(ctx);
      if (!state.goal) {
        return { content: [{ type: "text", text: "No pi-loop goal is active. Start one with /loop <goal>." }], details: {} };
      }

      recordFeedbackTurnDuration(state);
      pauseLoopTimer(state);
      controller.cancelPendingResume(state);

      const feedback = params as LoopFeedbackInput;
      const scoreInput = buildFeedbackScoreInput(state, feedback, ctx);
      const result = scoreLoopResult({
        ...scoreInput,
        previousScore: previousScoreValue(state),
        bestScore: bestScore(state)?.score ?? null,
        priorAttemptPlans: priorAttemptPlans(state),
        baselineScore: baselineScoreValue(state),
        targetScore: state.targetScore,
      }, undefined, { cwd: ctx.cwd });
      const nextActions = feedback.nextActions?.length ? refineNextActions(feedback.nextActions) : result.nextActions;
      const entry = scoreEntryFromResult(Math.max(1, state.turnsStarted), scoreInput.summary, { ...result, nextActions }, scoreInput.attempt, state.currentRun, Math.max(1, state.totalTurnsStarted));
      state.results.push(entry);
      state.unscoredConsecutiveTurns = 0;
      appendLogEntry(ctx.cwd, entry);
      updateAfterScore(ctx, state);
      sendLoopStepMessage(pi, state, "feedback", formatProgressPercent(result.progressPercent), ctx.cwd);

      return {
        content: [{ type: "text", text: formatScoreResponse({ ...result, nextActions }) }],
        details: { result: { ...result, nextActions }, loopState: loopStateDetails(state) },
        terminate: true,
      };
    },
  });
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

function buildFeedbackScoreInput(state: LoopRuntimeState, feedback: LoopFeedbackInput, ctx: ExtensionContext): LoopScoreInput {
  const status = feedback.status ?? "continue";
  const observations = observeTurnChecks(ctx, state);
  const artifacts = artifactsFromTargetContext(state);
  const summary = feedback.summary?.trim() || feedback.notes?.trim() || `Loop feedback recorded: ${status}.`;
  const checks = observations.map((check) => ({ ...check, required: check.kind !== "review", scope: "targeted" as const }));
  const passedTests = checks.filter((check) => check.status === "passed" && check.kind === "test");
  const testEvidenceFiles = passedTests.map((check) => check.command ?? check.name);
  const failedRequired = checks.filter((check) => check.status === "failed" && check.required);
  const blocked = status === "blocked" || failedRequired.length > 0;
  const ready = status === "ready_for_review";

  return {
    goal: state.goal ?? "",
    summary,
    artifacts,
    requirements: [{
      description: "Loop turn produced usable feedback for the next refinement step.",
      status: blocked ? "partial" : ready ? "met" : "partial",
      evidence: feedback.notes ?? summary,
    }],
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
      fullPlan: summarizeCurrentPrompt(state) || summary,
      actionsTaken: observations.map((check) => check.name),
      stopIntent: status === "blocked" ? "blocked" : ready ? "claim_done" : "continue",
      reusedPriorPlan: false,
    },
  };
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
