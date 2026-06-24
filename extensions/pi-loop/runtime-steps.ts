import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

import type { LoopRuntimeState, LoopScoreEntry } from "./state.ts";

export interface RuntimeStepRow {
  index: number;
  label: string;
  status: "done" | "active" | "waiting" | "stopped";
  detail: string;
}

interface RuntimeStepDraft {
  index: number;
  label: string;
  complete: boolean;
  active: boolean;
  detail: string;
}

export function runtimeStepRows(state: LoopRuntimeState): RuntimeStepRow[] {
  const hasConfig = state.startedAt !== null && state.goal !== null;
  const hasContext = state.targetContext !== null;
  const hasTurn = state.totalTurnsStarted > 0;
  const last = state.results.at(-1);
  const currentTurnScored = last !== undefined && (last.globalTurn ?? last.turn) >= state.totalTurnsStarted;
  const hasScore = state.results.length > 0;
  const done = !state.active && hasConfig;
  const agentWorkComplete = currentTurnScored || done || (hasTurn && state.currentTurnStartedAt === null);
  const agentWorkActive = state.active && hasTurn && !agentWorkComplete;
  const measureProgressActive = state.active && hasTurn && !currentTurnScored && agentWorkComplete;
  const resumeOrStopActive = state.active && currentTurnScored && hasScore;

  return finalizeRuntimeRows([
    row(1, "parse config", hasConfig, state.active, configDetail(state)),
    row(2, "capture context", hasContext, state.active && !hasTurn, contextDetail(state)),
    row(3, "persist log", hasConfig, state.active, ".loop/log.jsonl config entry"),
    row(4, "enable scorer", hasConfig, state.active, state.active ? "score_loop_result available" : "score_loop_result disabled"),
    row(5, "kickoff prompt", hasConfig, state.active && !hasTurn, "analysis, files, acceptance criteria, verification"),
    row(6, "inject guardrails", hasTurn, state.active && hasTurn, "goal, limits, hard rules, required evidence"),
    row(7, "start turn", hasTurn, state.active && hasTurn, `turn ${state.turnsStarted}/${state.maxTurns}, total ${state.totalTurnsStarted}`),
    row(8, "agent work", agentWorkComplete, agentWorkActive, currentTurnScored ? "scored" : measureProgressActive ? "ready for score_loop_result" : agentWorkComplete ? "work ended" : "work in progress"),
    row(9, "measure progress", currentTurnScored, measureProgressActive, currentTurnScored && last ? progressDetail(last) : "waiting for score_loop_result"),
    row(10, "feedback", hasScore, state.active && hasScore, feedbackDetail(state)),
    row(11, "resume or stop", done, resumeOrStopActive, state.stopReason ?? "feedback, budget, and stop-limit check"),
    row(12, "reconstruct", hasConfig, false, "state can resume from the log"),
  ], state.active);
}

export function formatRuntimeSteps(state: LoopRuntimeState): string {
  return [
    "Runtime steps:",
    ...runtimeStepRows(state).map((step) => `${String(step.index).padStart(2, "0")}. ${step.status.padEnd(7)} ${step.label} — ${step.detail}`),
  ].join("\n");
}

export function renderRuntimeStepTable(state: LoopRuntimeState, width: number, theme: Theme, maxRows: number): string[] {
  const rows = visibleRuntimeRows(runtimeStepRows(state), maxRows);
  const lines = [header(width, theme)];
  for (const step of rows) {
    lines.push(renderStep(step, width, theme));
  }
  return lines;
}

export function runtimeStepHistoryRows(state: LoopRuntimeState, previousRows = 5, nextRows = 4): RuntimeStepRow[] {
  const rows = runtimeStepRows(state);
  const currentIndex = currentRuntimeStepIndex(rows);
  const start = Math.max(0, currentIndex - previousRows);
  const end = Math.min(rows.length, currentIndex + nextRows + 1);
  const window = rows.slice(start, end);
  if (window.length <= previousRows + nextRows + 1) return window;
  return window.slice(window.length - (previousRows + nextRows + 1));
}

function visibleRuntimeRows(rows: RuntimeStepRow[], maxRows: number): RuntimeStepRow[] {
  if (rows.length <= maxRows) return rows;
  const activeIndex = rows.findIndex((step) => step.status === "active" || step.status === "waiting");
  const center = activeIndex === -1 ? rows.length - 1 : activeIndex;
  const start = Math.max(0, Math.min(center - Math.floor(maxRows / 2), rows.length - maxRows));
  return rows.slice(start, start + maxRows);
}

function currentRuntimeStepIndex(rows: RuntimeStepRow[]): number {
  const activeIndex = rows.findIndex((step) => step.status === "active");
  if (activeIndex !== -1) return activeIndex;
  const waitingIndex = rows.findIndex((step) => step.status === "waiting");
  if (waitingIndex !== -1) return waitingIndex;
  return Math.max(0, rows.length - 1);
}

function renderStep(step: RuntimeStepRow, width: number, theme: Theme): string {
  const index = pad(String(step.index).padStart(2, "0"), 4);
  const status = pad(step.status, 9);
  const label = pad(truncateToWidth(step.label, 17, "…", true), 18);
  const prefix = `  ${theme.fg("dim", index)}${theme.fg(statusColor(step.status), status)}${theme.fg("muted", label)}`;
  const detailWidth = Math.max(0, width - visibleWidth(prefix));
  return truncateToWidth(prefix + theme.fg("dim", truncateToWidth(step.detail, detailWidth, "…", true)), width, "…", true);
}

function header(width: number, theme: Theme): string {
  const label = "runtime steps";
  const line = `  ${theme.fg("muted", pad("#", 4))}${theme.fg("muted", pad("status", 9))}${theme.fg("muted", pad("step", 18))}${theme.fg("muted", "detail")}`;
  return width < 60 ? truncateToWidth(`  ${theme.fg("muted", label)}`, width, "…", true) : truncateToWidth(line, width, "…", true);
}

function row(index: number, label: string, complete: boolean, active: boolean, detail: string): RuntimeStepDraft {
  return { index, label, complete, active, detail };
}

function finalizeRuntimeRows(rows: RuntimeStepDraft[], activeLoop: boolean): RuntimeStepRow[] {
  if (!activeLoop) return rows.map((step) => ({ index: step.index, label: step.label, detail: step.detail, status: step.complete ? "done" : "waiting" }));

  const activeIndex = rows.findIndex((step) => step.active && !step.complete);
  const firstIncompleteIndex = rows.findIndex((step) => !step.complete);
  const currentIndex = activeIndex !== -1 ? activeIndex : firstIncompleteIndex === -1 ? rows.length - 1 : firstIncompleteIndex;

  return rows.map((step, index) => {
    if (index > currentIndex) return { index: step.index, label: step.label, detail: step.detail, status: "waiting" };
    if (index < currentIndex) return { index: step.index, label: step.label, detail: step.detail, status: step.complete ? "done" : "waiting" };
    const status = step.active && !step.complete ? "active" : step.complete ? "done" : "waiting";
    return { index: step.index, label: step.label, detail: step.detail, status };
  });
}

function configDetail(state: LoopRuntimeState): string {
  return state.goal ? `${state.maxTurns} turns, ${state.maxMinutes}m, ${state.maxRuns} run(s)` : "waiting for /loop goal";
}

function contextDetail(state: LoopRuntimeState): string {
  const context = state.targetContext;
  if (!context) return "waiting for snapshot";
  const git = context.baseline.git?.branch ? `, git ${context.baseline.git.branch}` : "";
  return `${context.baseline.packageManager ?? "unknown"}${git}, ${context.checks.length} checks`;
}

function progressDetail(entry: LoopScoreEntry): string {
  if (entry.progressPercent === null || entry.progressPercent === undefined) return "baseline recorded";
  return `${entry.progressPercent > 0 ? "+" : ""}${entry.progressPercent.toFixed(1)}% over baseline`;
}

function feedbackDetail(state: LoopRuntimeState): string {
  const last = state.results.at(-1);
  if (!last) return "waiting for first score";
  if (last.passedDefinition) return "new best recorded";
  return last.nextActions[0] ?? "next attempt required";
}

function statusColor(status: RuntimeStepRow["status"]): Parameters<Theme["fg"]>[0] {
  if (status === "done") return "success";
  if (status === "active") return "warning";
  if (status === "stopped") return "error";
  return "dim";
}

function pad(text: string, width: number): string {
  const visible = visibleWidth(text);
  if (visible >= width) return text;
  return text + " ".repeat(width - visible);
}
