import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

import { shortProgressPercent } from "./progress.ts";
import type { LoopRuntimeState, LoopScoreEntry } from "./state.ts";

interface ColumnSpec {
  key: string;
  label: string;
  width: number;
}

export function renderScoreTable(state: LoopRuntimeState, width: number, theme: Theme): string[] {
  if (state.results.length === 0) {
    return [
      truncateToWidth(`  ${theme.fg("dim", "No baseline attempt yet.")}`, width, "…", true),
      truncateToWidth(`  ${theme.fg("dim", "Call loop_feedback to record the first-loop baseline.")}`, width, "…", true),
    ];
  }

  const maxRows = width < 95 ? 4 : 6;
  const startIndex = Math.max(0, state.results.length - maxRows);
  const rows = state.results.slice(startIndex);
  const columns = baseColumns(width);
  const fixedWidth = columns.reduce((sum, column) => sum + column.width, 2);
  const detailWidth = Math.max(12, width - fixedWidth);
  const lines: string[] = [];

  lines.push(renderHeader(columns, detailWidth, width, theme));
  lines.push(truncateToWidth(`  ${theme.fg("dim", "─".repeat(Math.max(0, width - 4)))}`, width, "…", true));

  if (startIndex > 0) {
    lines.push(truncateToWidth(`  ${theme.fg("dim", `… ${startIndex} earlier attempt${startIndex === 1 ? "" : "s"}`)}`, width, "…", true));
  }

  for (let i = 0; i < rows.length; i++) {
    lines.push(renderRow(rows[i], startIndex + i, columns, detailWidth, width, theme));
  }

  return lines;
}

function baseColumns(width: number): ColumnSpec[] {
  return [
    { key: "index", label: "#", width: 4 },
    { key: "run", label: "run", width: 5 },
    { key: "progress", label: width < 70 ? "prog" : "progress", width: width < 70 ? 9 : 13 },
    { key: "state", label: "state", width: 10 },
  ];
}

function renderHeader(columns: ColumnSpec[], detailWidth: number, width: number, theme: Theme): string {
  const left = columns.map((column) => theme.fg("muted", pad(column.label, column.width))).join("");
  const line = `  ${left}${theme.fg("muted", truncateToWidth("detail", detailWidth, "…", true))}`;
  return truncateToWidth(line, width, "…", true);
}

function renderRow(entry: LoopScoreEntry, index: number, columns: ColumnSpec[], detailWidth: number, width: number, theme: Theme): string {
  const rowState = attemptState(entry);
  const color = stateColor(rowState);
  const values: Record<string, string> = {
    index: String(entry.globalTurn ?? index + 1),
    run: String(entry.run ?? 1),
    progress: shortProgressPercent(entry.progressPercent ?? null),
    state: rowState,
  };

  let line = "  ";
  for (const column of columns) {
    const value = pad(truncateToWidth(values[column.key] ?? "", column.width - 1, "…", true), column.width);
    line += theme.fg(columnColor(column.key, rowState, entry.progressPercent ?? null), value);
  }

  return truncateToWidth(line + theme.fg(color, truncateToWidth(detailText(entry), detailWidth, "…", true)), width, "…", true);
}

function attemptState(entry: LoopScoreEntry): string {
  if (entry.passedDefinition) return "new-best";
  if (entry.progressPercent === null || entry.progressPercent === undefined) return "baseline";
  if (entry.blockers.some((blocker) => blocker.severity === "blocker")) return "blocked";
  if (entry.outcome === "review_gate_failed") return "gates";
  if (entry.outcome === "verification_failed") return "verify";
  if (entry.outcome === "invalid_evidence") return "evidence";
  return "continue";
}

function detailText(entry: LoopScoreEntry): string {
  const blocker = entry.blockers.find((candidate) => candidate.severity === "blocker") ?? entry.blockers[0];
  if (blocker) return `blocker: ${blocker.message}`;
  if (entry.nextActions[0]) return `next: ${entry.nextActions[0]}`;
  return entry.summary;
}

function stateColor(rowState: string): Parameters<Theme["fg"]>[0] {
  if (rowState === "new-best") return "success";
  if (rowState === "blocked") return "error";
  if (rowState === "baseline") return "dim";
  return "warning";
}

function columnColor(key: string, rowState: string, progress: number | null): Parameters<Theme["fg"]>[0] {
  if (key === "state") return stateColor(rowState);
  if (key === "progress") return progress === null ? "dim" : progress > 0 ? "success" : "warning";
  return "dim";
}

function pad(text: string, width: number): string {
  const visible = visibleWidth(text);
  if (visible >= width) return text;
  return text + " ".repeat(width - visible);
}
