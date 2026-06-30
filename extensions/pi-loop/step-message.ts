import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { appendLogEntry } from "./log.ts";
import { acceptanceReady, normalTotalTurnsStarted, normalTurnsStarted, type LoopRuntimeState } from "./state.ts";

export function sendLoopStepMessage(pi: Pick<ExtensionAPI, "sendMessage">, state: LoopRuntimeState, step: string, detail?: string, cwd?: string): void {
  const timestamp = Date.now();
  const entry = {
    step,
    detail,
    run: state.currentRun,
    turn: state.turnsStarted,
    globalTurn: state.totalTurnsStarted,
    timestamp,
  };
  state.stepHistory = [...(state.stepHistory ?? []), entry];
  if (cwd) {
    try {
      appendLogEntry(cwd, { type: "event", schemaVersion: 2, event: "loop_step", timestamp, run: entry.run, turn: entry.turn, globalTurn: entry.globalTurn, reason: step, details: entry });
    } catch {
      // Step persistence is visibility-only. It must never block loop execution.
    }
  }

  try {
    const content = `Step: ${step}${detail ? ` — ${detail}` : ""}`;
    pi.sendMessage({
      customType: "pi-loop-step",
      content,
      display: true,
      details: entry,
    }, { triggerTurn: false });
  } catch {
    // Step messages are visibility-only. They must never block loop execution.
  }
}

export function loopTurnDetail(state: LoopRuntimeState): string {
  if (!acceptanceReady(state)) return `loop ${state.currentRun}, acceptance turn ${state.turnsStarted}, total ${state.totalTurnsStarted}`;
  return `loop ${state.currentRun}, turn ${normalTurnsStarted(state)}/${state.maxTurns}, total ${normalTotalTurnsStarted(state)}/${state.maxRuns * state.maxTurns}`;
}
