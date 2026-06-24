import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import { bestProgressEntry, formatProgressPercent, progressBarPercent } from "./progress.ts";
import { renderRuntimeStepTable } from "./runtime-steps.ts";
import { elapsedMs, lastScore, type LoopRuntimeState } from "./state.ts";
import { renderScoreTable } from "./ui-table.ts";

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

export function progressPercent(score: number | null, target: number): number {
  if (score === null) return 0;
  if (target <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((score / target) * 100)));
}

export function improvementText(value: number | null): string {
  if (value === null) return "n/a";
  return value > 0 ? `+${value}` : String(value);
}

export function updateLoopWidget(ctx: ExtensionContext, state: LoopRuntimeState): void {
  if (!ctx.hasUI) return;

  if (!state.active && state.results.length === 0) {
    ctx.ui.setWidget("pi-loop", undefined);
    ctx.ui.setStatus("pi-loop", undefined);
    return;
  }

  ctx.ui.setWidget("pi-loop", (_tui, theme) => ({
    render(width: number): string[] {
      return renderLoopWidget(state, Math.max(1, width), theme);
    },
    invalidate(): void {},
  }), { placement: "belowEditor" });

  const last = lastScore(state);
  const best = bestProgressEntry(state);
  const status = state.active ? "running" : state.stopReason ?? "stopped";
  ctx.ui.setStatus("pi-loop", ctx.ui.theme.fg("dim", `loop ${status}${last ? ` progress ${formatProgressPercent(last.progressPercent ?? null)}` : ""}${best ? ` best ${formatProgressPercent(best.progressPercent ?? null)}` : ""}`));
}

export function clearLoopWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget("pi-loop", undefined);
  ctx.ui.setStatus("pi-loop", undefined);
}

export function renderLoopWidget(state: LoopRuntimeState, width: number, theme: Theme): string[] {
  const safeWidth = Math.max(1, width);
  const scoreEntry = lastScore(state);
  const best = bestProgressEntry(state);
  const percent = progressBarPercent(scoreEntry?.progressPercent ?? null);
  const elapsed = formatElapsed(elapsedMs(state));
  const status = state.active ? "running" : state.stopReason ?? "stopped";
  const progressText = scoreEntry ? formatProgressPercent(scoreEntry.progressPercent ?? null) : "waiting for baseline";
  const bestText = best ? `${formatProgressPercent(best.progressPercent ?? null)} run ${best.run ?? 1}` : "none";
  const bar = progressBar(percent, Math.max(8, Math.min(24, Math.floor(safeWidth / 4))), theme);
  const goal = state.goal ? truncateToWidth(state.goal, Math.max(12, safeWidth - 8), "…", true) : "none";

  return [
    titleLine(`pi-loop ${status}`, safeWidth, theme),
    joinToWidth([
      theme.fg("muted", "Progress: "),
      theme.fg(scoreEntry?.passedDefinition ? "success" : "warning", progressText),
      theme.fg("dim", `  best ${bestText}`),
      theme.fg("dim", `  ${bar}`),
    ], safeWidth),
    joinToWidth([
      theme.fg("muted", "Budget: "),
      theme.fg("dim", `time ${elapsed}/${state.maxMinutes}m`),
      theme.fg("dim", `  run ${state.currentRun}/${state.maxRuns}`),
      theme.fg("dim", `  turn ${state.turnsStarted}/${state.maxTurns}`),
      theme.fg("dim", `  total ${state.totalTurnsStarted}`),
    ], safeWidth),
    truncateToWidth(`${theme.fg("muted", "Goal: ")}${theme.fg("dim", goal)}`, safeWidth, "…", true),
    ...renderRuntimeStepTable(state, safeWidth, theme, safeWidth < 95 ? 5 : 7),
    ...renderScoreTable(state, safeWidth, theme),
    detailLine(state, scoreEntry, safeWidth, theme),
  ];
}

function titleLine(title: string, width: number, theme: Theme): string {
  const label = ` ${title} `;
  const fill = Math.max(0, width - visibleWidth(label) - 3);
  return truncateToWidth(`${theme.fg("dim", "───")}${theme.fg("accent", label)}${theme.fg("dim", "─".repeat(fill))}`, width, "…", true);
}

function detailLine(state: LoopRuntimeState, scoreEntry: ReturnType<typeof lastScore>, width: number, theme: Theme): string {
  const blockers = scoreEntry?.blockers?.filter((blocker) => blocker.severity === "blocker") ?? [];
  const next = scoreEntry?.nextActions?.[0];
  const premature = state.prematureStopCount > 0 ? `  premature stops ${state.prematureStopCount}` : "";
  const detail = blockers.length > 0
    ? theme.fg("error", `Top blocker: ${blockers[0].message}${premature}`)
    : next
      ? theme.fg("dim", `Next: ${next}${premature}`)
      : theme.fg("dim", `score_loop_result required at the end of each loop turn${premature}`);
  return truncateToWidth(detail, width, "…", true);
}

function progressBar(percent: number, width: number, theme: Theme): string {
  const filled = Math.round((percent / 100) * width);
  const empty = Math.max(0, width - filled);
  return `${theme.fg("success", "█".repeat(filled))}${theme.fg("dim", "░".repeat(empty))}`;
}

function joinToWidth(parts: string[], width: number): string {
  let line = "";
  for (const part of parts) {
    if (!part) continue;
    const next = line + part;
    if (visibleWidth(next) <= width) {
      line = next;
      continue;
    }
    return truncateToWidth(line || part, width, "…", true);
  }
  return truncateToWidth(line, width, "…", true);
}
