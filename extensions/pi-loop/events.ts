import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MAX_UNSCORED_REMINDERS } from "./constants.ts";
import type { LoopController } from "./controller.ts";
import { appendLogEntry, reconstructLoopState } from "./log.ts";
import { assistantTextFromEvent, hasCompletionClaim, missingScoreReason, prematureStopPrompt } from "./premature-stop.ts";
import { continuePrompt, missingScorePrompt, nextRunPrompt, systemPromptAddon } from "./prompt.ts";
import { canStartNextRun, currentRunCanContinue, markCurrentRunStopped, startNextRun } from "./run-manager.ts";
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
    state.turnsStarted++;
    state.totalTurnsStarted++;
    state.lastAgentStartScoreCount = state.results.length;
    const run = state.runs.find((item) => item.index === state.currentRun);
    if (run) run.turnsStarted = state.turnsStarted;
    updateLoopWidget(ctx, state);
  });

  pi.on("agent_end", async (event, ctx) => {
    const state = controller.getState(ctx);
    if (!state.active) return;
    updateLoopWidget(ctx, state);
    if (controller.enforceLimits(ctx, state)) return;

    const claimedCompletion = hasCompletionClaim(assistantTextFromEvent(event));
    const scoredThisTurn = state.results.length > state.lastAgentStartScoreCount;
    if (!scoredThisTurn) {
      state.unscoredConsecutiveTurns++;
      appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "missing_score", timestamp: Date.now(), run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted, reason: missingScoreReason(claimedCompletion), details: { claimedCompletion } });
      if (state.unscoredConsecutiveTurns > MAX_UNSCORED_REMINDERS) {
        controller.finishLoop(ctx, state, "score tool was not called after repeated reminders");
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
      controller.scheduleResume(ctx, state, nextRunPrompt(state));
      return;
    }

    const last = state.results[state.results.length - 1];
    if (claimedCompletion && !last?.passedDefinition) {
      state.prematureStopCount++;
      appendLogEntry(ctx.cwd, { type: "event", schemaVersion: 2, event: "premature_stop", timestamp: Date.now(), run: state.currentRun, turn: state.turnsStarted, globalTurn: state.totalTurnsStarted, score: last?.score, targetScore: last?.targetScore, reason: "completion claim before verified improvement" });
      controller.scheduleResume(ctx, state, `${prematureStopPrompt(state)}\n\n${continuePrompt(state)}`);
      return;
    }

    controller.scheduleResume(ctx, state, continuePrompt(state));
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const state = controller.getState(ctx);
    if (!state.active) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${systemPromptAddon(state)}` };
  });
}
