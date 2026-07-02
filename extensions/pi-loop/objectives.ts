export type ObjectiveKind = "percent_change" | "max_threshold" | "min_threshold" | "target_value";
export type ObjectiveDirection = "decrease" | "increase" | "auto";

export interface NumericObjective {
  id: string;
  raw: string;
  metric: string;
  kind: ObjectiveKind;
  direction: ObjectiveDirection;
  value: number;
  unit: string | null;
  fromValue?: number;
}

export interface MeasuredMetric {
  name: string;
  value: number;
  unit?: string;
  sourceCommand?: string;
  verified?: boolean;
}

export interface ObjectiveStatus {
  targetValue: number;
  direction: Exclude<ObjectiveDirection, "auto">;
  satisfied: boolean;
  gapClosedPercent: number | null;
}

const MAX_OBJECTIVES = 5;
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const UNIT = String.raw`(%|percent(?:age)?|milliseconds?|msecs?|ms|seconds?|secs?|s\b|minutes?|mins?|hours?|hrs?|[kmg]i?b|bytes?|times|x\b|points?|pts|lines?|files?|failures?|errors?|warnings?|requests?|rps|qps)?`;
const DECREASE_VERBS = /^(reduce|cut|decrease|lower|shrink|drop|trim|speed up)$/i;

interface RawMatch {
  start: number;
  end: number;
  objective: Omit<NumericObjective, "id">;
}

export function extractNumericObjectives(goal: string): NumericObjective[] {
  const matches = [...fromToMatches(goal), ...percentChangeMatches(goal), ...thresholdMatches(goal), ...targetMatches(goal)]
    .sort((a, b) => a.start - b.start);
  const kept: RawMatch[] = [];
  for (const match of matches) {
    if (kept.some((existing) => overlaps(existing, match) || duplicates(existing, match))) continue;
    kept.push(match);
  }
  return kept.slice(0, MAX_OBJECTIVES).map((match, index) => ({ id: `O${index + 1}`, ...match.objective }));
}

export function formatNumericObjectives(objectives: NumericObjective[]): string {
  return objectives
    .map((objective) => `${objective.id}: ${objective.metric || "unnamed metric"} — ${objectiveTargetText(objective)} (from "${objective.raw}")`)
    .join("\n");
}

export function objectiveTargetText(objective: NumericObjective): string {
  const unit = objective.unit ?? "";
  if (objective.kind === "percent_change") return `${objective.direction === "decrease" ? "reduce" : "increase"} by ${objective.value}%`;
  if (objective.kind === "max_threshold") return `keep at or under ${objective.value}${unit}`;
  if (objective.kind === "min_threshold") return `reach at least ${objective.value}${unit}`;
  const from = objective.fromValue !== undefined ? ` from ${objective.fromValue}${unit}` : "";
  return `reach ${objective.value}${unit}${from}`;
}

export function objectiveStatus(objective: NumericObjective, baseline: number | null, current: number): ObjectiveStatus | null {
  const effectiveBaseline = baseline ?? objective.fromValue ?? null;
  if (objective.kind === "percent_change") {
    if (effectiveBaseline === null) return null;
    const factor = objective.direction === "decrease" ? 1 - objective.value / 100 : 1 + objective.value / 100;
    return statusFor(effectiveBaseline * factor, resolvedDirection(objective, effectiveBaseline), effectiveBaseline, current);
  }
  const direction = objective.kind === "max_threshold" ? "decrease" : objective.kind === "min_threshold" ? "increase" : resolvedDirection(objective, effectiveBaseline);
  return statusFor(objective.value, direction, effectiveBaseline, current);
}

export function normalizeMetrics(metrics: MeasuredMetric[] | undefined): MeasuredMetric[] {
  const seen = new Set<string>();
  const result: MeasuredMetric[] = [];
  for (const metric of metrics ?? []) {
    const name = (metric.name ?? "").replace(/\s+/g, " ").trim();
    if (!name || typeof metric.value !== "number" || !Number.isFinite(metric.value)) continue;
    const key = metricKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceCommand = (metric.sourceCommand ?? "").replace(/\s+/g, " ").trim();
    result.push({ name, value: metric.value, unit: normalizeUnit(metric.unit) ?? undefined, sourceCommand: sourceCommand || undefined });
  }
  return result;
}

export function canonicalizeMetrics(objectives: NumericObjective[], metrics: MeasuredMetric[]): MeasuredMetric[] {
  const indexByKey = new Map<string, number>();
  const result: MeasuredMetric[] = [];
  for (const metric of metrics) {
    const objective = matchObjective(objectives, metric.name);
    const canonical = objective ? convertToObjectiveUnit({ ...metric, name: objective.id }, objective) : metric;
    const key = metricKey(canonical.name);
    const existingIndex = indexByKey.get(key);
    if (existingIndex !== undefined) {
      if (result[existingIndex].verified === false && canonical.verified !== false) result[existingIndex] = canonical;
      continue;
    }
    indexByKey.set(key, result.length);
    result.push(canonical);
  }
  return result;
}

function convertToObjectiveUnit(metric: MeasuredMetric, objective: NumericObjective): MeasuredMetric {
  if (!metric.unit || !objective.unit || metric.unit === objective.unit) return metric;
  const converted = convertUnitValue(metric.value, metric.unit, objective.unit);
  if (converted === null) return metric;
  return { ...metric, value: converted, unit: objective.unit };
}

const TIME_UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, min: 60_000, h: 3_600_000 };
const SIZE_UNIT_BYTES: Record<string, number> = { b: 1, kb: 1_024, mb: 1_024 ** 2, gb: 1_024 ** 3 };

export function convertUnitValue(value: number, fromUnit: string, toUnit: string): number | null {
  if (fromUnit === toUnit) return value;
  for (const family of [TIME_UNIT_MS, SIZE_UNIT_BYTES]) {
    if (family[fromUnit] !== undefined && family[toUnit] !== undefined) return (value * family[fromUnit]) / family[toUnit];
  }
  return null;
}

export function matchObjective(objectives: NumericObjective[], metricName: string): NumericObjective | null {
  const key = metricKey(metricName);
  return objectives.find((objective) => metricKey(objective.id) === key)
    ?? objectives.find((objective) => {
      const objectiveKey = metricKey(objective.metric);
      return objectiveKey.length > 0 && (objectiveKey.includes(key) || key.includes(objectiveKey));
    })
    ?? null;
}

export function metricSeries(history: Array<{ metrics?: MeasuredMetric[] }>, metricName: string): number[] {
  const key = metricKey(metricName);
  return history.flatMap((entry) => (entry.metrics ?? []).filter((metric) => metricKey(metric.name) === key && metric.verified !== false).map((metric) => metric.value));
}

export function metricKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
}

function statusFor(targetValue: number, direction: Exclude<ObjectiveDirection, "auto">, baseline: number | null, current: number): ObjectiveStatus {
  const satisfied = direction === "decrease" ? current <= targetValue : current >= targetValue;
  const gap = baseline === null || baseline === targetValue ? null : clampPercent(((baseline - current) / (baseline - targetValue)) * 100);
  return { targetValue: round(targetValue), direction, satisfied, gapClosedPercent: gap };
}

function resolvedDirection(objective: NumericObjective, baseline: number | null): Exclude<ObjectiveDirection, "auto"> {
  if (objective.direction !== "auto") return objective.direction;
  if (baseline !== null) return baseline > objective.value ? "decrease" : "increase";
  return "increase";
}

function fromToMatches(goal: string): RawMatch[] {
  const pattern = new RegExp(String.raw`\bfrom\s+${NUM}\s*${UNIT}\s+(?:down\s+|up\s+)?to\s+${NUM}\s*${UNIT}`, "gi");
  return collect(goal, pattern, (match) => {
    const fromValue = Number(match[1]);
    const value = Number(match[3]);
    return {
      metric: metricLabel(goal, match.index, "before"),
      kind: "target_value",
      direction: fromValue > value ? "decrease" : "increase",
      value,
      unit: normalizeUnit(match[4] ?? match[2]),
      fromValue,
    };
  });
}

function percentChangeMatches(goal: string): RawMatch[] {
  const pattern = new RegExp(String.raw`\b(reduce|cut|decrease|lower|shrink|drop|trim|speed up|improve|increase|raise|boost|grow)\b([^.;!?]{0,60}?)\bby\s+${NUM}\s*(%|percent)`, "gi");
  return collect(goal, pattern, (match) => ({
    metric: cleanMetric(match[2]),
    kind: "percent_change",
    direction: DECREASE_VERBS.test(match[1]) ? "decrease" : "increase",
    value: Number(match[3]),
    unit: "%",
  }));
}

function thresholdMatches(goal: string): RawMatch[] {
  const maxPattern = new RegExp(String.raw`\b(?:under|below|less than|at most|no more than|within|up to|max(?:imum)?(?: of)?)\s+${NUM}\s*${UNIT}`, "gi");
  const minPattern = new RegExp(String.raw`\b(?:at least|above|over|more than|min(?:imum)?(?: of)?)\s+${NUM}\s*${UNIT}`, "gi");
  return [
    ...collect(goal, maxPattern, (match) => thresholdObjective(goal, match, "max_threshold", "decrease")),
    ...collect(goal, minPattern, (match) => thresholdObjective(goal, match, "min_threshold", "increase")),
  ];
}

function thresholdObjective(goal: string, match: RegExpExecArray, kind: ObjectiveKind, direction: ObjectiveDirection): Omit<NumericObjective, "id" | "raw"> {
  return {
    metric: metricLabel(goal, match.index, "around", match.index + match[0].length),
    kind,
    direction,
    value: Number(match[1]),
    unit: normalizeUnit(match[2]),
  };
}

function targetMatches(goal: string): RawMatch[] {
  const pattern = new RegExp(String.raw`\b(?:down to|(?:bring|get|take|push)\b[^.;!?]{0,50}?\bto)\s+${NUM}\s*${UNIT}`, "gi");
  return collect(goal, pattern, (match) => ({
    metric: metricLabel(goal, match.index, "around", match.index + match[0].length),
    kind: "target_value",
    direction: /down to/i.test(match[0]) ? "decrease" : "auto",
    value: Number(match[1]),
    unit: normalizeUnit(match[2]),
  }));
}

function collect(goal: string, pattern: RegExp, build: (match: RegExpExecArray) => Omit<NumericObjective, "id" | "raw"> | null): RawMatch[] {
  const matches: RawMatch[] = [];
  for (let match = pattern.exec(goal); match !== null; match = pattern.exec(goal)) {
    const objective = build(match);
    if (!objective || !Number.isFinite(objective.value)) continue;
    matches.push({ start: match.index, end: match.index + match[0].length, objective: { ...objective, raw: match[0].replace(/\s+/g, " ").trim() } });
  }
  return matches;
}

function metricLabel(goal: string, matchStart: number, mode: "before" | "around", matchEnd = matchStart): string {
  const before = cleanMetric(lastClause(goal.slice(0, matchStart)));
  if (mode === "before" || before) return before || cleanMetric(firstClause(goal.slice(matchEnd)));
  return cleanMetric(firstClause(goal.slice(matchEnd)));
}

function lastClause(text: string): string {
  const clause = text.split(/[.;!?,]/).at(-1) ?? "";
  return clause.split(/\s+/).filter(Boolean).slice(-4).join(" ");
}

function firstClause(text: string): string {
  const clause = text.split(/[.;!?,]/)[0] ?? "";
  return clause.split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
}

const METRIC_STOPWORDS = new Set(["the", "a", "an", "of", "for", "our", "its", "it", "is", "are", "be", "should", "must", "and", "or", "with", "to", "from", "keep", "keeping", "get", "make", "bring", "take", "push", "stay", "stays", "staying", "current", "total", "new", "them", "this", "that", "so", "at", "in", "on", "than", "while", "cut", "reduce", "decrease", "lower", "shrink", "trim", "drop", "improve", "increase", "raise", "boost", "grow"]);

function cleanMetric(text: string): string {
  return (text ?? "")
    .replace(/[`"'()]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !METRIC_STOPWORDS.has(word.toLowerCase()) && !/^\d/.test(word))
    .join(" ")
    .trim();
}

function normalizeUnit(unit: string | null | undefined): string | null {
  const value = (unit ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "%" || value.startsWith("percent")) return "%";
  if (value === "ms" || value.startsWith("millisecond") || value.startsWith("msec")) return "ms";
  if (value === "s" || value.startsWith("sec")) return "s";
  if (value.startsWith("min")) return "min";
  if (value === "h" || value.startsWith("hour") || value.startsWith("hr")) return "h";
  if (/^[kmg]i?b$/.test(value)) return value.replace("i", "");
  if (value.startsWith("byte")) return "b";
  if (value === "x" || value === "times") return "x";
  if (value.startsWith("point") || value === "pts") return "points";
  return value.replace(/s$/, "");
}

function overlaps(a: RawMatch, b: RawMatch): boolean {
  return a.start < b.end && b.start < a.end;
}

function duplicates(a: RawMatch, b: RawMatch): boolean {
  return a.objective.kind === b.objective.kind
    && a.objective.value === b.objective.value
    && a.objective.unit === b.objective.unit
    && a.objective.direction === b.objective.direction
    && metricKey(a.objective.metric) === metricKey(b.objective.metric);
}

function clampPercent(value: number): number {
  return round(Math.max(-999, Math.min(999, value)));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
