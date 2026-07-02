import { matchObjective, metricSeries, objectiveStatus, objectiveTargetText, type MeasuredMetric, type NumericObjective } from "./objectives.ts";

export interface MetricHistoryEntry {
  metrics?: MeasuredMetric[];
}

export interface ObservedCommandEvidence {
  command?: string;
  evidence: string;
}

export function verifyMetrics(metrics: MeasuredMetric[], observed: ObservedCommandEvidence[]): MeasuredMetric[] {
  return metrics.map((metric) => ({ ...metric, verified: metricValueObserved(metric, observed) }));
}

function metricValueObserved(metric: MeasuredMetric, observed: ObservedCommandEvidence[]): boolean {
  const valueForms = numberForms(metric.value);
  return observed.some((entry) => valueForms.some((form) => new RegExp(`(^|[^\\d.])${escapeRegExp(form)}([^\\d.]|$)`).test(entry.evidence)));
}

function numberForms(value: number): string[] {
  const forms = new Set([String(value), value.toFixed(0), value.toFixed(1), value.toFixed(2)]);
  return [...forms];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatMetricFeedback(objectives: NumericObjective[], priorHistory: MetricHistoryEntry[], metrics: MeasuredMetric[]): string[] {
  return metrics.map((metric) => formatMetricLine(objectives, priorHistory, metric));
}

export function unreportedObjectives(objectives: NumericObjective[], history: MetricHistoryEntry[]): NumericObjective[] {
  const reported = new Set(history.flatMap((entry) => verifiedMetrics(entry).map((metric) => matchObjective(objectives, metric.name)?.id)).filter(Boolean));
  return objectives.filter((objective) => !reported.has(objective.id));
}

export function metricTrendLines(objectives: NumericObjective[], history: MetricHistoryEntry[], maxMetrics = 4): string[] {
  const latest = new Map<string, MeasuredMetric>();
  for (const entry of history) {
    for (const metric of verifiedMetrics(entry)) {
      const known = [...latest.keys()].find((name) => sameMetric(name, metric.name));
      latest.set(known ?? metric.name, metric);
    }
  }
  return [...latest.entries()].slice(0, maxMetrics).map(([name, metric]) => {
    const series = metricSeries(history, name);
    const objective = matchObjective(objectives, name);
    const trend = series.map((value) => String(shortNumber(value))).join(" → ");
    return `${metricDisplayName(objective, name)}: ${trend}${objectiveSuffix(objective, series, metric.unit)}${confidenceSuffix(series)}`;
  });
}

export function metricConfidence(series: number[]): number | null {
  if (series.length < 3) return null;
  const baseline = series[0];
  const bestImprovement = Math.max(...series.map((value) => Math.abs(value - baseline)));
  const mad = medianAbsoluteDeviation(series);
  if (mad === 0) return null;
  return shortNumber(bestImprovement / mad);
}

function confidenceSuffix(series: number[]): string {
  const confidence = metricConfidence(series);
  if (confidence === null) return "";
  return ` (confidence ${confidence}x noise${confidence < 1 ? " — within noise, re-measure before trusting" : confidence < 2 ? " — marginal, consider re-measuring" : ""})`;
}

function medianAbsoluteDeviation(series: number[]): number {
  const med = median(series);
  return median(series.map((value) => Math.abs(value - med)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function verifiedMetrics(entry: MetricHistoryEntry): MeasuredMetric[] {
  return (entry.metrics ?? []).filter((metric) => metric.verified !== false);
}

function formatMetricLine(objectives: NumericObjective[], priorHistory: MetricHistoryEntry[], metric: MeasuredMetric): string {
  const objective = matchObjective(objectives, metric.name);
  const series = metricSeries(priorHistory, metric.name);
  const unit = metric.unit ?? objective?.unit ?? "";
  const name = metricDisplayName(objective, metric.name);
  if (series.length === 0) {
    return `${name}: ${shortNumber(metric.value)}${unit} (baseline recorded)${objectiveSuffix(objective, [metric.value], metric.unit)}${verificationSuffix(metric)}`;
  }
  const baseline = series[0];
  const deltaPercent = baseline === 0 ? null : ((metric.value - baseline) / Math.abs(baseline)) * 100;
  const delta = deltaPercent === null ? "" : ` (${deltaPercent > 0 ? "+" : ""}${shortNumber(deltaPercent)}% vs baseline ${shortNumber(baseline)}${unit})`;
  return `${name}: ${shortNumber(metric.value)}${unit}${delta}${objectiveSuffix(objective, [...series, metric.value], metric.unit)}${verificationSuffix(metric)}`;
}

function verificationSuffix(metric: MeasuredMetric): string {
  return metric.verified === false ? " [unverified — no matching command output observed this turn]" : "";
}

function objectiveSuffix(objective: NumericObjective | null, series: number[], metricUnit?: string): string {
  if (!objective || series.length === 0) return "";
  if (metricUnit && objective.unit && metricUnit !== objective.unit) {
    return ` — ${objective.id} target ${objectiveTargetText(objective)}: not comparable (unit mismatch: ${metricUnit} vs ${objective.unit})`;
  }
  const current = series[series.length - 1];
  const baseline = series.length > 1 ? series[0] : objective.fromValue ?? (series.length === 1 ? series[0] : null);
  const status = objectiveStatus(objective, baseline, current);
  if (!status) return ` — ${objective.id} target: ${objectiveTargetText(objective)} (needs a baseline measurement)`;
  if (status.satisfied) return ` — ${objective.id} target ${objectiveTargetText(objective)}: met`;
  const gap = status.gapClosedPercent !== null && series.length > 1 ? `, ${shortNumber(status.gapClosedPercent)}% of gap closed` : "";
  return ` — ${objective.id} target ${objectiveTargetText(objective)}: not met (needs ${status.direction === "decrease" ? "<=" : ">="} ${status.targetValue}${objective.unit ?? ""}${gap})`;
}

function metricDisplayName(objective: NumericObjective | null, name: string): string {
  if (!objective) return name;
  const label = objective.metric && !sameMetric(objective.metric, name) && !sameMetric(objective.id, name) ? name : objective.metric || name;
  return `${objective.id} ${label}`.trim();
}

function sameMetric(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function shortNumber(value: number): number {
  return Math.round(value * 100) / 100;
}
