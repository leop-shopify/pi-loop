import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { RESUME_DELAY_MS } from "./constants.ts";
import { finalLoopSummary } from "./final-summary.ts";
import { appendLogEntry } from "./log.ts";
import type { RuntimeStore } from "./runtime-store.ts";
import { bestScoreReason } from "./run-manager.ts";
import { clearLoopWidget, updateLoopWidget } from "./ui.ts";
import { deadlineReached, stopLoop, turnLimitReached, type LoopRuntimeState } from "./state.ts";

export interface LoopController {
  scoreToolName: string;
  sessionKey(ctx: ExtensionContext): string;
  getState(ctx: ExtensionContext): LoopRuntimeState;
  setScoreToolActive(enabled: boolean): void;
  cancelPendingResume(state: LoopRuntimeState): void;
  clearSession(ctx: ExtensionContext): void;
  finishLoop(ctx: ExtensionContext, state: LoopRuntimeState, reason: string): void;
  sendWhenReady(message: string, ctx: ExtensionContext): void;
  scheduleResume(ctx: ExtensionContext, state: LoopRuntimeState, message: string): void;
  enforceLimits(ctx: ExtensionContext, state: LoopRuntimeState): boolean;
}

export function createLoopController(pi: ExtensionAPI, store: RuntimeStore, scoreToolName: string): LoopController {
  const sessionKey = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId();
  const getState = (ctx: ExtensionContext): LoopRuntimeState => store.ensure(sessionKey(ctx));

  const setScoreToolActive = (enabled: boolean): void => {
    const active = new Set(pi.getActiveTools());
    if (enabled) active.add(scoreToolName);
    else active.delete(scoreToolName);
    pi.setActiveTools([...active]);
  };

  const cancelPendingResume = (state: LoopRuntimeState): void => {
    if (!state.pendingResumeTimer) return;
    clearTimeout(state.pendingResumeTimer);
    state.pendingResumeTimer = null;
  };

  const finishLoop = (ctx: ExtensionContext, state: LoopRuntimeState, reason: string): void => {
    stopLoop(state, reason);
    setScoreToolActive(false);
    appendLogEntry(ctx.cwd, { type: "event", event: "stopped", timestamp: Date.now(), reason });
    const summary = finalLoopSummary(state, reason);
    clearLoopWidget(ctx);
    if (ctx.isIdle()) pi.sendUserMessage(summary);
    else pi.sendUserMessage(summary, { deliverAs: "followUp" });
  };

  return {
    scoreToolName,
    sessionKey,
    getState,
    setScoreToolActive,
    cancelPendingResume,
    clearSession(ctx: ExtensionContext): void {
      cancelPendingResume(getState(ctx));
      clearLoopWidget(ctx);
      store.clear(sessionKey(ctx));
    },
    finishLoop,
    sendWhenReady(message: string, ctx: ExtensionContext): void {
      const state = getState(ctx);
      state.currentPrompt = message;
      updateLoopWidget(ctx, state);
      if (ctx.isIdle()) pi.sendUserMessage(message);
      else pi.sendUserMessage(message, { deliverAs: "followUp" });
    },
    scheduleResume(ctx: ExtensionContext, state: LoopRuntimeState, message: string): void {
      cancelPendingResume(state);
      state.currentPrompt = message;
      updateLoopWidget(ctx, state);
      state.pendingResumeTimer = setTimeout(() => {
        state.pendingResumeTimer = null;
        if (!state.active) return;
        if (ctx.isIdle() && !ctx.hasPendingMessages()) pi.sendUserMessage(message);
        else pi.sendUserMessage(message, { deliverAs: "followUp" });
      }, RESUME_DELAY_MS);
    },
    enforceLimits(ctx: ExtensionContext, state: LoopRuntimeState): boolean {
      if (deadlineReached(state)) {
        finishLoop(ctx, state, "time limit reached");
        return true;
      }
      if (turnLimitReached(state) && state.currentRun >= state.maxRuns) {
        finishLoop(ctx, state, bestScoreReason(state));
        return true;
      }
      return false;
    },
  };
}
