import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { LoopRuntimeState } from "./state.ts";

export function sendLoopStepMessage(pi: Pick<ExtensionAPI, "sendMessage">, state: LoopRuntimeState, step: string, detail?: string): void {
  try {
    const content = `Step: ${step}${detail ? ` — ${detail}` : ""}`;
    pi.sendMessage({
      customType: "pi-loop-step",
      content,
      display: true,
      details: {
        step,
        detail,
        run: state.currentRun,
        turn: state.turnsStarted,
        globalTurn: state.totalTurnsStarted,
        timestamp: Date.now(),
      },
    }, { triggerTurn: false });
  } catch {
    // Step messages are visibility-only. They must never block loop execution.
  }
}

export function loopTurnDetail(state: LoopRuntimeState): string {
  return `loop ${state.currentRun}, turn ${state.turnsStarted}/${state.maxTurns}, total ${state.totalTurnsStarted}/${state.maxRuns * state.maxTurns}`;
}
