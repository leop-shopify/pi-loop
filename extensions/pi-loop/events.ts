import type { AgentEndEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { createAgentEndGate, type AgentEndGate } from "./agent-end-gate.ts";
import { childAgentsPending, probeChildAgentLifecycle } from "./child-agent-lifecycle.ts";
import { MAX_UNSCORED_REMINDERS } from "./constants.ts";
import type { LoopController } from "./controller.ts";
import { appendLogEntry, reconstructLoopState } from "./log.ts";
import { assistantTextFromEvent, hasCompletionClaim, missingScoreReason, prematureStopPrompt } from "./premature-stop.ts";
import { continuePrompt, delegationPendingPrompt, missingScorePrompt, nextRunPrompt, systemPromptAddon } from "./prompt.ts";
import { canStartNextRun, currentRunCanContinue, markCurrentRunStopped, startNextRun } from "./run-manager.ts";
import { acceptanceReady, pauseLoopTimer, resumeLoopTimer } from "./state.ts";
import { loopTurnDetail, sendLoopStepMessage } from "./step-message.ts";
import { updateLoopWidget } from "./ui.ts";

export function registerLoopEvents(pi: ExtensionAPI, controller: LoopController, agentEndGate: AgentEndGate = createAgentEndGate()): void {
  let activeState: ReturnType<LoopController["getState"]> | null = null;
  const spawnCalls = new Map<string, number>();
  const unsubscribeAgentReport = pi.events?.on?.("pi-extended-teams:agent-report", () => {
    if (!activeState?.active || !activeState.delegationPending) return;
    activeState.delegationReportsReceived++;
  });

  pi.on("session_start", async (_event, ctx) => {
    const restored = reconstructLoopState(ctx.cwd, Date.now(), controller.sessionKey(ctx));
    controller.clearSession(ctx);
    Object.assign(controller.getState(ctx), restored);
    activeState = controller.getState(ctx);
    controller.setScoreToolActive(restored.active);
    updateLoopWidget(ctx, restored);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    agentEndGate.cancel();
    spawnCalls.clear();
    activeState = null;
    if (typeof unsubscribeAgentReport === "function") unsubscribeAgentReport();
    controller.clearSession(ctx);
  });

  pi.on("session_before_compact", (event) => {
    if (event.reason === "overflow") agentEndGate.compactionStarted(event.willRetry);
  });

  pi.on("session_compact", (event) => {
    if (event.reason === "overflow") agentEndGate.compactionFinished(event.willRetry);
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    const state = controller.getState(ctx);
    activeState = state;
    if (!state.active) return;
    const count = spawnedAgentCountForTool(event.toolName, event.args);
    if (count === 0) return;
    spawnCalls.set(event.toolCallId, count);
    controller.cancelPendingResume(state);
    beginDelegationWait(state, count);
    updateLoopWidget(ctx, state);
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const count = spawnCalls.get(event.toolCallId);
    if (!count) return;
    spawnCalls.delete(event.toolCallId);
    if (!event.isError) return;
    const state = controller.getState(ctx);
    state.delegationExpectedReports = Math.max(0, state.delegationExpectedReports - count);
    if (state.delegationExpectedReports === 0) clearDelegationWait(state);
    updateLoopWidget(ctx, state);
  });

  pi.on("agent_start", async (_event, ctx) => {
    if (agentEndGate.consumeRetryStart()) return;
    const state = controller.getState(ctx);
    activeState = state;
    if (!state.active) return;
    controller.cancelPendingResume(state);
    const startedAt = Date.now();
    const lifecycleSnapshot = probeChildAgentLifecycle(pi, controller.sessionKey(ctx));
    if (state.delegationPending) {
      if (lifecycleSnapshot && childAgentsPending(lifecycleSnapshot)) {
        state.delegationObservedActive = true;
        captureContextUsage(ctx, state);
        updateLoopWidget(ctx, state);
        return;
      }
      const reportsComplete = state.delegationExpectedReports > 0
        && state.delegationReportsReceived >= state.delegationExpectedReports;
      const reachedIdleAfterActive = state.delegationObservedActive && lifecycleSnapshot !== null;
      if (!reportsComplete && !reachedIdleAfterActive) {
        captureContextUsage(ctx, state);
        updateLoopWidget(ctx, state);
        return;
      }
      clearDelegationWait(state);
    } else if (lifecycleSnapshot && childAgentsPending(lifecycleSnapshot)) {
      beginDelegationWait(state, 0);
      state.delegationObservedActive = true;
      captureContextUsage(ctx, state);
      updateLoopWidget(ctx, state);
      return;
    }

    if (state.pendingFeedbackTurn) {
      resumeLoopTimer(state, startedAt);
      state.lastAgentStartScoreCount = state.results.length;
      captureContextUsage(ctx, state);
      updateLoopWidget(ctx, state);
      sendLoopStepMessage(pi, state, "recording feedback", loopTurnDetail(state), ctx.cwd);
      return;
    }

    resumeLoopTimer(state, startedAt);
    state.turnsStarted++;
    state.totalTurnsStarted++;
    state.currentTurnStartedAt = startedAt;
    state.lastAgentStartScoreCount = state.results.length;
    const run = state.runs.find((item) => item.index === state.currentRun);
    if (run) run.turnsStarted = state.turnsStarted;
    appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "turn_started", timestamp: startedAt, run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted });
    captureContextUsage(ctx, state);
    updateLoopWidget(ctx, state);
    sendLoopStepMessage(pi, state, acceptanceReady(state) ? "starting agent work" : "planning acceptance criteria", loopTurnDetail(state), ctx.cwd);
  });

  pi.on("agent_end", async (event, ctx) => {
    const state = controller.getState(ctx);
    activeState = state;
    if (!state.active) return;
    return agentEndGate.defer(event, ctx, async () => {
      if (!state.active) return;
      recordTurnDuration(state);
      captureContextUsage(ctx, state);
      updateLoopWidget(ctx, state);

      const claimedCompletion = hasCompletionClaim(assistantTextFromEvent(event));
      const lifecycleSnapshot = probeChildAgentLifecycle(pi, controller.sessionKey(ctx));
      const spawnedCount = spawnedAgentCount(event);
      if (spawnedCount > 0 && !state.delegationPending) beginDelegationWait(state, spawnedCount);
      if (lifecycleSnapshot && childAgentsPending(lifecycleSnapshot)) {
        if (!state.delegationPending) beginDelegationWait(state, 0);
        state.delegationObservedActive = true;
      }
      if (state.delegationPending) {
        pauseLoopTimer(state);
        state.unscoredConsecutiveTurns = 0;
        state.currentPrompt = delegationPendingPrompt(state);
        updateLoopWidget(ctx, state);
        if (state.stepHistory.at(-1)?.step !== "delegation pending") {
          appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "delegation_pending", timestamp: Date.now(), run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted, reason: "spawned agents are running or queued; waiting for focused reports before feedback", details: { claimedCompletion, lifecycleSnapshot, spawnedCount, expectedReports: state.delegationExpectedReports } });
          sendLoopStepMessage(pi, state, "delegation pending", "spawned agents are running or queued; waiting for focused reports before feedback", ctx.cwd);
        }
        return;
      }

      sendLoopStepMessage(pi, state, "review loop", loopTurnDetail(state), ctx.cwd);
      if (controller.enforceLimits(ctx, state)) return;

      const scoredThisTurn = state.results.length > state.lastAgentStartScoreCount;
      if (!scoredThisTurn) {
        state.unscoredConsecutiveTurns++;
        if (!acceptanceReady(state)) {
          state.unscoredConsecutiveTurns = 0;
          sendLoopStepMessage(pi, state, "planning acceptance criteria", "acceptance criteria must be clear and trackable before agent work starts", ctx.cwd);
          controller.scheduleResume(ctx, state, continuePrompt(state));
          return;
        }

        state.pendingFeedbackTurn = { run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted };
        appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "missing_score", timestamp: Date.now(), run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted, reason: missingScoreReason(claimedCompletion), details: { claimedCompletion } });
        sendLoopStepMessage(pi, state, "missing feedback", missingScoreReason(claimedCompletion), ctx.cwd);
        if (state.unscoredConsecutiveTurns > MAX_UNSCORED_REMINDERS) {
          controller.finishLoop(ctx, state, "loop_feedback was not called after repeated reminders");
          return;
        }
        controller.scheduleResume(ctx, state, missingScorePrompt(state, claimedCompletion));
        return;
      }

      if (!acceptanceReady(state)) {
        sendLoopStepMessage(pi, state, "planning acceptance criteria", "acceptance criteria not ready for normal agent work", ctx.cwd);
        controller.scheduleResume(ctx, state, continuePrompt(state));
        return;
      }

      if (!currentRunCanContinue(state) && canStartNextRun(state)) {
        markCurrentRunStopped(state, "turn limit reached");
        appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "run_stopped", timestamp: Date.now(), run: state.currentRun, reason: "turn limit reached" });
        startNextRun(state);
        appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "run_started", timestamp: Date.now(), run: state.currentRun });
        updateLoopWidget(ctx, state);
        sendLoopStepMessage(pi, state, `restarting loop ${state.currentRun}`, `run ${state.currentRun}/${state.maxRuns}`, ctx.cwd);
        controller.scheduleResume(ctx, state, nextRunPrompt(state));
        return;
      }

      const last = state.results[state.results.length - 1];
      if (claimedCompletion) {
        state.prematureStopCount++;
        appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "premature_stop", timestamp: Date.now(), run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted, score: last?.score, targetScore: last?.targetScore, reason: "completion claim before configured loop stop" });
        sendLoopStepMessage(pi, state, "continuing loop", "completion claim before configured stop", ctx.cwd);
        controller.scheduleResume(ctx, state, `${prematureStopPrompt(state)}\n\n${continuePrompt(state)}`);
        return;
      }

      sendLoopStepMessage(pi, state, "continuing loop", "scheduled refined prompt", ctx.cwd);
      controller.scheduleResume(ctx, state, continuePrompt(state));
    });
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const state = controller.getState(ctx);
    if (!state.active) return;
    state.currentPrompt = event.prompt;
    captureContextUsage(ctx, state);
    updateLoopWidget(ctx, state);
    return { systemPrompt: `${event.systemPrompt}\n\n${systemPromptAddon(state)}` };
  });
}

function spawnedAgentCount(event: AgentEndEvent): number {
  const messages = Array.isArray(event.messages) ? event.messages : [];
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return messages.slice(lastUserIndex + 1).reduce((total, message) => {
    if (message.role !== "assistant") return total;
    const content = Array.isArray(message.content) ? message.content : [];
    return total + content.reduce((count, part) => {
      if (part.type !== "toolCall") return count;
      return count + spawnedAgentCountForTool(part.name, part.arguments);
    }, 0);
  }, 0);
}

function spawnedAgentCountForTool(toolName: string, args: unknown): number {
  if (toolName === "spawn_agent") return 1;
  if (toolName !== "spawn_swarm_agents") return 0;
  const agents = args && typeof args === "object" ? (args as { agents?: unknown }).agents : undefined;
  return Array.isArray(agents) ? agents.length : 1;
}

function beginDelegationWait(state: ReturnType<LoopController["getState"]>, expectedReports: number): void {
  if (!state.delegationPending) {
    state.delegationPending = true;
    state.delegationExpectedReports = 0;
    state.delegationReportsReceived = 0;
    state.delegationObservedActive = false;
  }
  state.delegationExpectedReports += expectedReports;
  pauseLoopTimer(state);
}

function clearDelegationWait(state: ReturnType<LoopController["getState"]>): void {
  state.delegationPending = false;
  state.delegationExpectedReports = 0;
  state.delegationReportsReceived = 0;
  state.delegationObservedActive = false;
}

function recordTurnDuration(state: ReturnType<LoopController["getState"]>): void {
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

function captureContextUsage(ctx: Parameters<LoopController["getState"]>[0], state: ReturnType<LoopController["getState"]>): void {
  const usage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
  state.contextUsage = usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : null;
}
