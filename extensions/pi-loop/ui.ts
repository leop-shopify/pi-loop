import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import { bestScore, elapsedMs, lastScore, type LoopRuntimeState } from "./state.ts";

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

  const score = lastScore(state)?.score ?? null;
  const best = bestScore(state)?.score ?? null;
  const status = state.active ? "running" : state.stopReason ?? "stopped";
  ctx.ui.setStatus("pi-loop", ctx.ui.theme.fg("dim", `loop ${status}${score === null ? "" : ` ${score}/${state.targetScore}`}${best === null ? "" : ` best ${best}`}`));
}

export function clearLoopWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget("pi-loop", undefined);
  ctx.ui.setStatus("pi-loop", undefined);
}

export function renderLoopWidget(state: LoopRuntimeState, width: number, theme: Theme): string[] {
  const scoreEntry = lastScore(state);
  const best = bestScore(state);
  const score = scoreEntry?.score ?? null;
  const percent = progressPercent(score, state.targetScore);
  const elapsed = formatElapsed(elapsedMs(state));
  const status = state.active ? "running" : state.stopReason ?? "stopped";
  const goal = state.goal ? ` ${state.goal}` : "";
  const title = joinToWidth([
    theme.fg("accent", "pi-loop"),
    theme.fg("dim", ` ${status}`),
    theme.fg("dim", ` time ${elapsed}/${state.maxMinutes}m`),
    theme.fg("dim", ` run ${state.currentRun}/${state.maxRuns}`),
    theme.fg("dim", ` turn ${state.turnsStarted}/${state.maxTurns}`),
    theme.fg("dim", ` total ${state.totalTurnsStarted}`),
    theme.fg("dim", goal),
  ], width);

  const scoreText = score === null ? "unscored" : `${score}/${state.targetScore}`;
  const bar = progressBar(percent, Math.max(8, Math.min(24, Math.floor(width / 4))), theme);
  const improvement = improvementText(scoreEntry?.improvement ?? null);
  const bestText = best ? ` best ${best.score}/${best.targetScore}` : "";
  const line = joinToWidth([
    theme.fg("muted", "done "),
    theme.fg(score !== null && score >= state.targetScore ? "success" : "warning", scoreText),
    theme.fg("dim", bestText),
    theme.fg("dim", ` ${bar} ${percent}%`),
    theme.fg("muted", " improvement "),
    theme.fg(improvement.startsWith("+") ? "success" : improvement === "n/a" ? "dim" : "warning", improvement),
  ], width);

  const blockers = scoreEntry?.blockers?.filter((blocker) => blocker.severity === "blocker") ?? [];
  const next = scoreEntry?.nextActions?.[0];
  const premature = state.prematureStopCount > 0 ? ` premature stops ${state.prematureStopCount}` : "";
  const detail = blockers.length > 0
    ? theme.fg("error", `blocker: ${blockers[0].message}${premature}`)
    : next
      ? theme.fg("dim", `next: ${next}${premature}`)
      : theme.fg("dim", `score_loop_result required at the end of each loop turn${premature}`);

  return [truncateToWidth(title, width, "…", true), truncateToWidth(line, width, "…", true), truncateToWidth(detail, width, "…", true)];
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
