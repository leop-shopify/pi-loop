import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { acceptanceReadyTurn, normalTotalTurnsStarted, normalTurnsStarted, normalWorkStarted, type LoopRuntimeState, type LoopScoreEntry } from "./state.ts";

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
  const readyTurn = acceptanceReadyTurn(state);
  const acceptanceReady = readyTurn !== null;
  const hasNormalWork = normalWorkStarted(state);
  const normalLast = acceptanceReady ? state.results.filter((entry) => (entry.globalTurn ?? entry.turn) > readyTurn).at(-1) : undefined;
  const acceptancePlanningActive = state.active && hasTurn && !acceptanceReady;
  const agentWorkActive = state.active && hasNormalWork && state.currentTurnStartedAt !== null;
  const currentTurnScored = !agentWorkActive && normalLast !== undefined && (normalLast.globalTurn ?? normalLast.turn) >= state.totalTurnsStarted;
  const hasScore = normalLast !== undefined;
  const done = !state.active && hasConfig;
  const agentWorkComplete = hasNormalWork && !agentWorkActive && (currentTurnScored || done || state.currentTurnStartedAt === null);
  const measureProgressActive = state.active && hasNormalWork && !currentTurnScored && agentWorkComplete;
  const resumeOrStopActive = state.active && currentTurnScored && hasScore;

  return finalizeRuntimeRows([
    row(1, "parse config", hasConfig, state.active, configDetail(state)),
    row(2, "capture context", hasContext, state.active && !hasTurn, contextDetail(state)),
    row(3, "bounded research", hasContext, state.active && !hasTurn, "spawned agents report before the 10m cap; partial findings carry forward"),
    row(4, "persist log", hasConfig, state.active, "~/.pi/agent/pi-loop/projects/.../log.jsonl config entry"),
    row(5, "enable feedback", hasConfig, state.active, state.active ? "loop_feedback available" : "loop_feedback disabled"),
    row(6, "kickoff prompt", hasConfig, state.active && !hasTurn, "acceptance discovery, user confirmation, trackable plan"),
    row(7, "inject guardrails", hasTurn, state.active && hasTurn, "goal, limits, hard rules, required evidence"),
    row(8, "plan acceptance", acceptanceReady, acceptancePlanningActive, acceptanceDetail(state)),
    row(9, "start turn", hasNormalWork, state.active && acceptanceReady && !hasNormalWork, hasNormalWork ? `turn ${normalTurnsStarted(state)}/${state.maxTurns}, total ${normalTotalTurnsStarted(state)}` : "waiting for clear, confirmed, trackable acceptance criteria"),
    row(10, "agent work", agentWorkComplete, agentWorkActive, currentTurnScored ? "feedback recorded" : measureProgressActive ? "ready for loop_feedback" : agentWorkComplete ? "work ended" : "work in progress"),
    row(11, "measure progress", currentTurnScored, measureProgressActive, currentTurnScored && normalLast ? progressDetail(normalLast) : "waiting for loop_feedback"),
    row(12, "feedback", hasScore, state.active && hasScore, feedbackDetail(state)),
    row(13, "resume or stop", done, resumeOrStopActive, state.stopReason ?? "feedback, budget, and stop-limit check"),
    row(14, "reconstruct", hasConfig, false, "state can resume from the log"),
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
  return state.goal ? `${state.maxTurns} turns, ${state.maxMinutes}m, ${state.maxRuns} run(s)` : "waiting for /goal objective";
}

function contextDetail(state: LoopRuntimeState): string {
  const context = state.targetContext;
  if (!context) return "waiting for snapshot";
  const git = context.baseline.git?.branch ? `, git ${context.baseline.git.branch}` : "";
  return `${context.baseline.packageManager ?? "unknown"}${git}, ${context.checks.length} checks`;
}

function acceptanceDetail(state: LoopRuntimeState): string {
  const readyTurn = acceptanceReadyTurn(state);
  if (readyTurn !== null) return `criteria confirmed with trackable plan at turn ${readyTurn}`;
  const status = state.results.at(-1)?.attempt?.acceptanceStatus;
  if (status === "proposed") return "candidate criteria proposed; waiting for user confirmation";
  if (status === "discovering") return "discovering criteria through questions or research";
  if (status === "missing") return "criteria missing; ask contextual discovery questions";
  return "planning clear, confirmed, trackable acceptance criteria";
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
