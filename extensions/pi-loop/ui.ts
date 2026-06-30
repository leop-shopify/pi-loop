import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

import { hideFloatingPanel, showFloatingPanel } from "./floating-panel.ts";
import { bestProgressEntry, formatProgressPercent, progressBarPercent } from "./progress.ts";
import { acceptanceReady, elapsedMs, lastScore, normalTotalTurnsStarted, type LoopRuntimeState, type LoopStepHistoryEntry } from "./state.ts";

const PANEL_KEY = "pi-loop";
const MIN_PROMPT_LINE_LIMIT = 15;
const SECTION_FRAME_ROWS = 2;

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

  ctx.ui.setWidget(PANEL_KEY, undefined);

  if (!state.active && state.results.length === 0) {
    hideFloatingPanel(ctx, PANEL_KEY);
    ctx.ui.setStatus(PANEL_KEY, undefined);
    return;
  }

  captureContextUsage(ctx, state);
  if (state.panelVisible) showFloatingPanel(ctx, PANEL_KEY, state, renderLoopWidget);
  else hideFloatingPanel(ctx, PANEL_KEY);

  ctx.ui.setStatus(PANEL_KEY, undefined);
}

export function setLoopWidgetVisible(ctx: ExtensionContext, state: LoopRuntimeState, visible: boolean): void {
  state.panelVisible = visible;
  updateLoopWidget(ctx, state);
}

export function toggleLoopWidget(ctx: ExtensionContext, state: LoopRuntimeState): boolean {
  setLoopWidgetVisible(ctx, state, !state.panelVisible);
  return state.panelVisible;
}

export function clearLoopWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  hideFloatingPanel(ctx, PANEL_KEY);
  ctx.ui.setWidget(PANEL_KEY, undefined);
  ctx.ui.setStatus(PANEL_KEY, undefined);
}

export function renderLoopWidget(state: LoopRuntimeState, width: number, theme: Theme, height?: number): string[] {
  const safeWidth = Math.max(1, width);
  const status = state.active ? "running" : state.stopReason ?? "stopped";
  const contentWidth = Math.max(1, safeWidth - 4);
  const targetContentHeight = Math.max(0, (height ?? 0) - 2);
  const data = dataLines(state, contentWidth, theme);
  const history = stepHistoryLines(state, contentWidth, theme, historyLineLimitForHeight(targetContentHeight, data.length));
  const promptLimit = promptLineLimitForHeight(targetContentHeight, data.length, history.length);
  const content = fitContentHeight([
    ...section("data", data, contentWidth, theme),
    ...section("current prompt", promptLines(state, contentWidth, theme, promptLimit), contentWidth, theme),
    ...section("step history", history, contentWidth, theme),
  ], targetContentHeight, contentWidth);

  return bordered(`pi-loop ${status}`, content, safeWidth, theme);
}

function captureContextUsage(ctx: ExtensionContext, state: LoopRuntimeState): void {
  const usage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
  state.contextUsage = usage ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent } : state.contextUsage;
}

function dataLines(state: LoopRuntimeState, width: number, theme: Theme): string[] {
  const scoreEntry = lastScore(state);
  const best = bestProgressEntry(state);
  const progressText = scoreEntry ? formatProgressPercent(scoreEntry.progressPercent ?? null) : "waiting for baseline";
  const bestText = best ? `${formatProgressPercent(best.progressPercent ?? null)} run ${best.run ?? 1}` : "none";
  const turnElapsed = state.currentTurnStartedAt === null ? null : Date.now() - state.currentTurnStartedAt;
  const turnText = turnElapsed === null ? "idle" : formatElapsed(turnElapsed);
  const lastTurnText = state.lastTurnDurationMs === null ? "none" : formatElapsed(state.lastTurnDurationMs);
  const bar = progressBar(progressBarPercent(scoreEntry?.progressPercent ?? null), Math.max(6, Math.min(14, Math.floor(width / 3))), theme);

  return [
    keyValueLine("turn", turnUsageText(state), width, theme),
    keyValueLine("time", `${formatElapsed(elapsedMs(state))}/${state.maxMinutes}m all, current ${turnText}`, width, theme),
    keyValueLine("last turn", lastTurnText, width, theme),
    keyValueLine("tokens", contextUsageText(state), width, theme),
    keyValueLine("progress", `${progressText} ${bar}`, width, theme),
    keyValueLine("best", bestText, width, theme),
    keyValueLine("ace", aceRunText(state), width, theme),
    ...recentTurnLines(state, width, theme),
  ];
}

function turnUsageText(state: LoopRuntimeState): string {
  if (!acceptanceReady(state)) return `acceptance turn ${state.totalTurnsStarted}, 0/${state.maxTurns * state.maxRuns} normal total, run ${state.currentRun}/${state.maxRuns}`;
  return `${normalTotalTurnsStarted(state)}/${state.maxTurns * state.maxRuns} normal total, run ${state.currentRun}/${state.maxRuns}`;
}

function promptLines(state: LoopRuntimeState, width: number, theme: Theme, maxLines: number): string[] {
  const summaryLines = promptSummaryLines(state, width);
  const lines = summaryLines.slice(0, maxLines);
  if (lines.length === 0) return [theme.fg("text", "Waiting for the next loop prompt.")];
  if (summaryLines.length > maxLines && lines.length > 0) {
    lines[lines.length - 1] = truncateToWidth(`${lines[lines.length - 1]} …`, width, "…", true);
  }
  return lines.map((line) => truncateToWidth(theme.fg("text", line), width, "…", true));
}

function promptSummaryLines(state: LoopRuntimeState, width: number): string[] {
  const goal = state.goal?.trim() || "Waiting for the next loop prompt.";
  return labeledWrappedLines("Now", compactSummaryText(goal, 300), width);
}

function labeledWrappedLines(label: string, value: string, width: number): string[] {
  const prefix = `${label}: `;
  const prefixWidth = visibleWidth(prefix);
  const valueWidth = Math.max(1, width - prefixWidth);
  const wrapped = wrapPlainTextFully(value, valueWidth);
  if (wrapped.length === 0) return [prefix.trimEnd()];
  return wrapped.map((line, index) => `${index === 0 ? prefix : " ".repeat(prefixWidth)}${line}`);
}

function compactSummaryText(text: string, maxChars: number): string {
  const compacted = text.replace(/\s+/g, " ").trim();
  if (compacted.length <= maxChars) return compacted;
  return `${compacted.slice(0, maxChars).replace(/\s+\S*$/, "").trimEnd()}…`;
}

function promptLineLimitForHeight(targetHeight: number, dataRows: number, historyRows: number): number {
  if (targetHeight <= 0) return MIN_PROMPT_LINE_LIMIT;
  const fixedRows = sectionRowCount(dataRows) + sectionRowCount(historyRows) + SECTION_FRAME_ROWS;
  return Math.max(1, targetHeight - fixedRows);
}

function historyLineLimitForHeight(targetHeight: number, dataRows: number): number | undefined {
  if (targetHeight <= 0) return undefined;
  const availableAfterData = targetHeight - sectionRowCount(dataRows) - SECTION_FRAME_ROWS;
  return Math.max(1, availableAfterData - sectionRowCount(1));
}

function sectionRowCount(lineCount: number): number {
  return lineCount + SECTION_FRAME_ROWS;
}

function stepHistoryLines(state: LoopRuntimeState, width: number, theme: Theme, maxLines?: number): string[] {
  const entries = state.stepHistory ?? [];
  if (entries.length === 0) return [theme.fg("dim", "No pi-loop-step messages recorded yet.")];
  const firstRenderedIndex = maxLines !== undefined && entries.length > maxLines ? entries.length - maxLines : 0;
  return entries.slice(firstRenderedIndex).map((entry, index) => renderHistoryStep(entry, firstRenderedIndex + index + 1, firstRenderedIndex + index === entries.length - 1 && state.active, width, theme));
}

function renderHistoryStep(entry: LoopStepHistoryEntry, index: number, active: boolean, width: number, theme: Theme): string {
  const marker = active ? ">" : " ";
  const status = active ? "now" : "done";
  const prefix = `${marker} ${String(index).padStart(2, "0")} ${pad(status, 5)} `;
  const label = truncateToWidth(entry.step, 22, "…", true);
  const detail = entry.detail ?? `loop ${entry.run}, turn ${entry.turn}, total ${entry.globalTurn}`;
  const detailWidth = Math.max(0, width - visibleWidth(prefix) - visibleWidth(label) - 3);
  const color = active ? "warning" : "success";
  return truncateToWidth(theme.fg(color, prefix) + theme.fg("muted", label) + theme.fg("dim", ` - ${truncateToWidth(detail, detailWidth, "…", true)}`), width, "…", true);
}

function recentTurnLines(state: LoopRuntimeState, width: number, theme: Theme): string[] {
  if (state.turnDurations.length === 0) return [];
  const recent = state.turnDurations.slice(-4).map((entry) => `#${entry.globalTurn} ${formatElapsed(entry.durationMs)}`).join(", ");
  return keyValueWrappedLines("recent", recent, width, theme);
}

function aceRunText(state: LoopRuntimeState): string {
  const run = state.aceRun;
  if (!run) return "not launched";
  if (run.status === "running") return run.pid !== undefined ? `running pid ${run.pid}` : "running";
  return run.message ?? run.status;
}

function contextUsageText(state: LoopRuntimeState): string {
  const usage = state.contextUsage;
  if (!usage) return "n/a";
  const tokens = usage.tokens === null ? "unknown" : compactNumber(usage.tokens);
  const percent = usage.percent === null ? "n/a" : `${Math.round(usage.percent)}%`;
  return `${tokens}/${compactNumber(usage.contextWindow)} ${percent}`;
}

function keyValueLine(key: string, value: string, width: number, theme: Theme): string {
  const label = `${key}: `;
  return truncateToWidth(theme.fg("muted", label) + theme.fg("text", value), width, "…", true);
}

function keyValueWrappedLines(key: string, value: string, width: number, theme: Theme, maxLines = Number.POSITIVE_INFINITY): string[] {
  const label = `${key}: `;
  const labelWidth = visibleWidth(label);
  const valueWidth = Math.max(1, width - labelWidth);
  const wrapped = wrapPlainTextFully(value, valueWidth).slice(0, maxLines);
  if (wrapped.length === 0) return [truncateToWidth(theme.fg("muted", label), width, "…", true)];
  return wrapped.map((line, index) => {
    const prefix = index === 0 ? label : " ".repeat(labelWidth);
    return truncateToWidth(theme.fg("muted", prefix) + theme.fg("text", line), width, "…", true);
  });
}

function progressBar(percent: number, width: number, theme: Theme): string {
  const filled = Math.round((percent / 100) * width);
  const empty = Math.max(0, width - filled);
  return `${theme.fg("success", "█".repeat(filled))}${theme.fg("dim", "░".repeat(empty))}`;
}

function fitContentHeight(lines: string[], targetHeight: number, width: number): string[] {
  if (targetHeight <= 0) return lines;
  const fitted = lines.slice(0, targetHeight);
  while (fitted.length < targetHeight) fitted.push(" ".repeat(width));
  return fitted;
}

function section(title: string, lines: string[], width: number, theme: Theme): string[] {
  return [sectionTitle(title, width, theme), ...lines.map((line) => truncateToWidth(line, width, "…", true)), ""];
}

function sectionTitle(title: string, width: number, theme: Theme): string {
  const label = ` ${title} `;
  const fill = Math.max(0, width - visibleWidth(label));
  return truncateToWidth(theme.fg("borderMuted", "─".repeat(Math.floor(fill / 2))) + theme.fg("accent", label) + theme.fg("borderMuted", "─".repeat(Math.ceil(fill / 2))), width, "…", true);
}

function bordered(title: string, lines: string[], width: number, theme: Theme): string[] {
  if (width < 4) return lines.map((line) => truncateToWidth(line, width, "", true));
  const inner = Math.max(1, width - 2);
  const top = borderTitle(title, width, theme);
  const body = lines.map((line) => contentLine(line, inner, theme));
  const bottom = theme.fg("borderAccent", `╰${"─".repeat(inner)}╯`);
  return [top, ...body, bottom].map((line) => truncateToWidth(line, width, "", true));
}

function borderTitle(title: string, width: number, theme: Theme): string {
  const inner = Math.max(1, width - 2);
  const label = truncateToWidth(` ${title} `, inner, "…", true);
  const fill = Math.max(0, inner - visibleWidth(label));
  return theme.fg("borderAccent", `╭${"─".repeat(Math.floor(fill / 2))}`) + theme.fg("accent", label) + theme.fg("borderAccent", `${"─".repeat(Math.ceil(fill / 2))}╮`);
}

function contentLine(line: string, inner: number, theme: Theme): string {
  const text = pad(truncateToWidth(line, inner, "…", true), inner);
  return theme.fg("border", "│") + text + theme.fg("border", "│");
}

function wrapPlainText(text: string, width: number, maxLines: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return ["n/a"];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }

  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === 0) lines.push(truncateToWidth(normalized, width, "…", true));

  const consumed = lines.join(" ");
  if (visibleWidth(consumed) < visibleWidth(normalized) && lines.length > 0) {
    lines[lines.length - 1] = truncateToWidth(`${lines[lines.length - 1]} …`, width, "…", true);
  }

  return lines.slice(0, maxLines);
}

function wrapPlainTextFully(text: string, width: number): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines;
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function pad(text: string, width: number): string {
  const visible = visibleWidth(text);
  if (visible >= width) return text;
  return text + " ".repeat(width - visible);
}
