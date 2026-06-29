import type { AgentEndEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { buildAceLoopContext } from "./ace-context.ts";
import { MAX_UNSCORED_REMINDERS } from "./constants.ts";
import type { LoopController } from "./controller.ts";
import { appendLogEntry, reconstructLoopState } from "./log.ts";
import { assistantTextFromEvent, hasCompletionClaim, missingScoreReason, prematureStopPrompt } from "./premature-stop.ts";
import { continuePrompt, delegationPendingPrompt, missingScorePrompt, nextRunPrompt, systemPromptAddon } from "./prompt.ts";
import { canStartNextRun, currentRunCanContinue, markCurrentRunStopped, startNextRun } from "./run-manager.ts";
import { resumeLoopTimer } from "./state.ts";
import { loopTurnDetail, sendLoopStepMessage } from "./step-message.ts";
import { updateLoopWidget } from "./ui.ts";

export function registerLoopEvents(pi: ExtensionAPI, controller: LoopController): void {
  pi.on("session_start", async (_event, ctx) => {
    const restored = reconstructLoopState(ctx.cwd, Date.now(), controller.sessionKey(ctx));
    controller.clearSession(ctx);
    Object.assign(controller.getState(ctx), restored);
    controller.setScoreToolActive(restored.active);
    updateLoopWidget(ctx, restored);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    controller.clearSession(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    const state = controller.getState(ctx);
    if (!state.active) return;
    controller.cancelPendingResume(state);
    const startedAt = Date.now();

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
    sendLoopStepMessage(pi, state, "starting agent work", loopTurnDetail(state), ctx.cwd);
  });

  pi.on("agent_end", async (event, ctx) => {
    const state = controller.getState(ctx);
    if (!state.active) return;
    recordTurnDuration(state);
    captureContextUsage(ctx, state);
    updateLoopWidget(ctx, state);
    sendLoopStepMessage(pi, state, "review loop", loopTurnDetail(state), ctx.cwd);
    if (controller.enforceLimits(ctx, state)) return;

    const claimedCompletion = hasCompletionClaim(assistantTextFromEvent(event));
    const scoredThisTurn = state.results.length > state.lastAgentStartScoreCount;
    const spawnedAgentsThisTurn = turnSpawnedAgents(event);
    if (!scoredThisTurn) {
      if (spawnedAgentsThisTurn) {
        state.unscoredConsecutiveTurns = 0;
        state.currentPrompt = delegationPendingPrompt(state);
        appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "delegation_pending", timestamp: Date.now(), run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted, reason: "spawned agents are running; waiting for focused reports before feedback", details: { claimedCompletion } });
        updateLoopWidget(ctx, state);
        sendLoopStepMessage(pi, state, "delegation pending", "spawned agents are running; waiting for focused reports before feedback", ctx.cwd);
        return;
      }

      state.unscoredConsecutiveTurns++;
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

    if (!currentRunCanContinue(state) && canStartNextRun(state)) {
      markCurrentRunStopped(state, "turn limit reached");
      appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "run_stopped", timestamp: Date.now(), run: state.currentRun, reason: "turn limit reached" });
      startNextRun(state);
      appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "run_started", timestamp: Date.now(), run: state.currentRun });
      updateLoopWidget(ctx, state);
      sendLoopStepMessage(pi, state, `restarting loop ${state.currentRun}`, `run ${state.currentRun}/${state.maxRuns}`, ctx.cwd);
      const aceContext = await buildAceLoopContext(ctx);
      controller.scheduleResume(ctx, state, nextRunPrompt(state, { aceContext }));
      return;
    }

    const last = state.results[state.results.length - 1];
    if (claimedCompletion) {
      state.prematureStopCount++;
      appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "premature_stop", timestamp: Date.now(), run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted, score: last?.score, targetScore: last?.targetScore, reason: "completion claim before configured loop stop" });
      sendLoopStepMessage(pi, state, "continuing loop", "completion claim before configured stop", ctx.cwd);
      const aceContext = await buildAceLoopContext(ctx);
      controller.scheduleResume(ctx, state, `${prematureStopPrompt(state)}\n\n${continuePrompt(state, { aceContext })}`);
      return;
    }

    sendLoopStepMessage(pi, state, "continuing loop", "scheduled refined prompt", ctx.cwd);
    const aceContext = await buildAceLoopContext(ctx);
    controller.scheduleResume(ctx, state, continuePrompt(state, { aceContext }));
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

function turnSpawnedAgents(event: AgentEndEvent): boolean {
  const messages = Array.isArray(event.messages) ? event.messages : [];
  return messages.some((message) => {
    if (message.role === "toolResult") return message.toolName === "spawn_agent" || message.toolName === "spawn_swarm_agents";
    if (message.role !== "assistant") return false;
    const content = Array.isArray(message.content) ? message.content : [];
    return content.some((part) => part.type === "toolCall" && (part.name === "spawn_agent" || part.name === "spawn_swarm_agents"));
  });
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
