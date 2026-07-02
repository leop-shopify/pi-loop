import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalizeMetrics, convertUnitValue, extractNumericObjectives, formatNumericObjectives, matchObjective, metricSeries, normalizeMetrics, objectiveStatus } from "../extensions/pi-loop/objectives.ts";
import { formatMetricFeedback, metricConfidence, metricTrendLines, unreportedObjectives, verifyMetrics } from "../extensions/pi-loop/metric-feedback.ts";
import { buildTargetContextSnapshot, formatTargetContext } from "../extensions/pi-loop/target-context.ts";
import { kickoffPrompt, systemPromptAddon } from "../extensions/pi-loop/prompt.ts";
import { createLoopState, scoreEntryFromResult } from "../extensions/pi-loop/state.ts";

test("percent-change objectives are extracted with direction", () => {
  const decrease = extractNumericObjectives("Reduce the bundle size by 20% without breaking tests");
  assert.equal(decrease.length, 1);
  assert.equal(decrease[0].kind, "percent_change");
  assert.equal(decrease[0].direction, "decrease");
  assert.equal(decrease[0].value, 20);
  assert.equal(decrease[0].unit, "%");
  assert.match(decrease[0].metric, /bundle size/);

  const increase = extractNumericObjectives("improve branch coverage by 15 percent");
  assert.equal(increase[0].direction, "increase");
  assert.equal(increase[0].value, 15);
});

test("threshold objectives are extracted for under and at-least phrasing", () => {
  const max = extractNumericObjectives("keep p95 response time under 200ms");
  assert.equal(max.length, 1);
  assert.equal(max[0].kind, "max_threshold");
  assert.equal(max[0].direction, "decrease");
  assert.equal(max[0].value, 200);
  assert.equal(max[0].unit, "ms");
  assert.match(max[0].metric, /response time/);

  const min = extractNumericObjectives("test coverage must be at least 90%");
  assert.equal(min[0].kind, "min_threshold");
  assert.equal(min[0].direction, "increase");
  assert.equal(min[0].value, 90);
  assert.equal(min[0].unit, "%");
});

test("from-to objectives capture an explicit baseline and target", () => {
  const objectives = extractNumericObjectives("cut test runtime from 40s to 25s");
  assert.equal(objectives.length, 1);
  assert.equal(objectives[0].kind, "target_value");
  assert.equal(objectives[0].direction, "decrease");
  assert.equal(objectives[0].fromValue, 40);
  assert.equal(objectives[0].value, 25);
  assert.equal(objectives[0].unit, "s");
});

test("multiple objectives get stable ids and goals without numbers get none", () => {
  const objectives = extractNumericObjectives("Reduce build time by 30% and keep bundle under 500kb");
  assert.equal(objectives.length, 2);
  assert.deepEqual(objectives.map((objective) => objective.id), ["O1", "O2"]);

  assert.deepEqual(extractNumericObjectives("Improve the CartCalculator discount tests without mocking owned code"), []);
});

test("objective status computes targets, satisfaction, and gap closed", () => {
  const [objective] = extractNumericObjectives("reduce test runtime by 20%");
  const partial = objectiveStatus(objective, 100, 90);
  assert.equal(partial.targetValue, 80);
  assert.equal(partial.satisfied, false);
  assert.equal(partial.gapClosedPercent, 50);

  const done = objectiveStatus(objective, 100, 78);
  assert.equal(done.satisfied, true);

  const [threshold] = extractNumericObjectives("coverage at least 90%");
  assert.equal(objectiveStatus(threshold, null, 92).satisfied, true);
  assert.equal(objectiveStatus(threshold, null, 85).satisfied, false);
});

test("metrics normalize, match objectives by id or name, and build series", () => {
  const objectives = extractNumericObjectives("keep bundle size under 500kb");
  const metrics = normalizeMetrics([
    { name: " O1 ", value: 520.4, unit: "KB" },
    { name: "O1", value: 999 },
    { name: "bad", value: Number.NaN },
  ]);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].unit, "kb");
  assert.equal(matchObjective(objectives, "O1"), objectives[0]);
  assert.equal(matchObjective(objectives, "bundle size"), objectives[0]);
  assert.equal(matchObjective(objectives, "latency"), null);

  const history = [{ metrics: [{ name: "O1", value: 520 }] }, { metrics: [{ name: "o1", value: 480 }] }];
  assert.deepEqual(metricSeries(history, "O1"), [520, 480]);
});

test("metric feedback reports baseline, delta, and objective target state", () => {
  const objectives = extractNumericObjectives("keep bundle size under 500kb");
  const baselineLines = formatMetricFeedback(objectives, [], [{ name: "O1", value: 520, unit: "kb" }]);
  assert.match(baselineLines[0], /baseline recorded/);
  assert.match(baselineLines[0], /O1/);
  assert.match(baselineLines[0], /not met/);

  const history = [{ metrics: [{ name: "O1", value: 520, unit: "kb" }] }];
  const progressLines = formatMetricFeedback(objectives, history, [{ name: "O1", value: 480, unit: "kb" }]);
  assert.match(progressLines[0], /480kb/);
  assert.match(progressLines[0], /-7\.69% vs baseline 520kb/);
  assert.match(progressLines[0], /target keep at or under 500kb: met/);
});

test("metric trend lines and unreported objectives support continuation prompts", () => {
  const objectives = extractNumericObjectives("reduce runtime by 20% and keep bundle under 500kb");
  const history = [
    { metrics: [{ name: "O1", value: 100 }] },
    { metrics: [{ name: "O1", value: 90 }] },
  ];
  const lines = metricTrendLines(objectives, history);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /100 → 90/);

  const missing = unreportedObjectives(objectives, history);
  assert.deepEqual(missing.map((objective) => objective.id), ["O2"]);
});

test("target context snapshot carries objectives and formats them", () => {
  const snapshot = buildTargetContextSnapshot({ cwd: process.cwd(), goal: "reduce test runtime by 30%" });
  assert.equal(snapshot.objectives.length, 1);
  const text = formatTargetContext(snapshot);
  assert.match(text, /measurable objectives:/);
  assert.match(text, /O1: test runtime — reduce by 30%/);
  assert.match(formatNumericObjectives(snapshot.objectives), /reduce by 30%/);
});

test("kickoff and system prompts instruct measured baselines for objectives", () => {
  const state = createLoopState();
  state.goal = "reduce test runtime by 30%";
  state.targetContext = buildTargetContextSnapshot({ cwd: process.cwd(), goal: state.goal });

  for (const prompt of [kickoffPrompt(state), systemPromptAddon(state)]) {
    assert.match(prompt, /Measurable objectives parsed from the goal:/);
    assert.match(prompt, /Objective measurement rule/);
    assert.match(prompt, /loop_feedback metrics/);
  }

  const plainState = createLoopState();
  plainState.goal = "improve the discount tests";
  plainState.targetContext = buildTargetContextSnapshot({ cwd: process.cwd(), goal: plainState.goal });
  assert.doesNotMatch(kickoffPrompt(plainState), /Measurable objectives parsed/);
});

test("same target values on different metrics are all kept", () => {
  const percents = extractNumericObjectives("reduce latency by 20% and reduce memory by 20%");
  assert.equal(percents.length, 2);
  assert.match(percents[0].metric, /latency/);
  assert.match(percents[1].metric, /memory/);

  const thresholds = extractNumericObjectives("keep p95 under 200ms and keep p99 under 200ms");
  assert.equal(thresholds.length, 2);
  assert.match(thresholds[0].metric, /p95/);
  assert.match(thresholds[1].metric, /p99/);
});

test("objective metric labels strip change verbs", () => {
  const [objective] = extractNumericObjectives("cut test runtime from 40s to 25s");
  assert.equal(objective.metric, "test runtime");
});

test("metrics canonicalize to the objective id so history stays one series", () => {
  const objectives = extractNumericObjectives("keep bundle size under 500kb");
  const canonical = canonicalizeMetrics(objectives, normalizeMetrics([{ name: "bundle size", value: 480 }, { name: "latency", value: 12 }]));
  assert.equal(canonical[0].name, "O1");
  assert.equal(canonical[1].name, "latency");

  const history = [{ metrics: [{ name: "O1", value: 520, unit: "kb" }] }];
  const lines = formatMetricFeedback(objectives, history, canonical.slice(0, 1));
  assert.match(lines[0], /vs baseline 520/);
  assert.doesNotMatch(lines[0], /baseline recorded/);
});

test("verification requires the value in observed output; sourceCommand alone is not enough", () => {
  const observed = [
    { command: "pnpm build && du -sk dist", evidence: "480\tdist" },
    { command: "pnpm test", evidence: "tests 120 pass 120" },
  ];
  const [byValue, fabricated, unbacked] = verifyMetrics([
    { name: "O1", value: 480 },
    { name: "O2", value: 999999, sourceCommand: "pnpm test" },
    { name: "O3", value: 99.9 },
  ], observed);
  assert.equal(byValue.verified, true);
  assert.equal(fabricated.verified, false);
  assert.equal(fabricated.sourceCommand, "pnpm test");
  assert.equal(unbacked.verified, false);

  const lines = formatMetricFeedback([], [], [unbacked]);
  assert.match(lines[0], /\[unverified — no matching command output observed this turn\]/);
  const verifiedLines = formatMetricFeedback([], [], [byValue]);
  assert.doesNotMatch(verifiedLines[0], /unverified/);
});

test("compatible units convert to the objective unit before target comparison", () => {
  assert.equal(convertUnitValue(2, "s", "ms"), 2000);
  assert.equal(convertUnitValue(1, "mb", "kb"), 1024);
  assert.equal(convertUnitValue(1, "s", "kb"), null);

  const objectives = extractNumericObjectives("keep bundle size under 500kb");
  const [converted] = canonicalizeMetrics(objectives, normalizeMetrics([{ name: "O1", value: 1, unit: "MB" }]));
  assert.equal(converted.value, 1024);
  assert.equal(converted.unit, "kb");
  const lines = formatMetricFeedback(objectives, [], [converted]);
  assert.match(lines[0], /1024kb/);
  assert.match(lines[0], /not met/);
});

test("incompatible units are reported as not comparable instead of a false target status", () => {
  const objectives = extractNumericObjectives("coverage must be at least 90%");
  const lines = formatMetricFeedback(objectives, [], [{ name: "O1", value: 5, unit: "s" }]);
  assert.match(lines[0], /not comparable \(unit mismatch: s vs %\)/);
  assert.doesNotMatch(lines[0], /: met/);
});

test("unverified metrics do not become baselines, trends, or reported objectives", () => {
  const objectives = extractNumericObjectives("keep bundle size under 500kb");
  const history = [{ metrics: [{ name: "O1", value: 123456, verified: false }] }];

  assert.deepEqual(metricSeries(history, "O1"), []);
  assert.equal(metricTrendLines(objectives, history).length, 0);
  assert.deepEqual(unreportedObjectives(objectives, history).map((objective) => objective.id), ["O1"]);

  const lines = formatMetricFeedback(objectives, history, [{ name: "O1", value: 480, unit: "kb", verified: true }]);
  assert.match(lines[0], /baseline recorded/);
});

test("a value does not verify against a longer decimal in output", () => {
  const [prefix] = verifyMetrics([{ name: "t", value: 480 }], [{ evidence: "took 480.5s" }]);
  assert.equal(prefix.verified, false);
  const [exact] = verifyMetrics([{ name: "t", value: 480 }], [{ evidence: "took 480s" }]);
  assert.equal(exact.verified, true);
});

test("canonicalization dedupe prefers a verified duplicate over an unverified one", () => {
  const objectives = extractNumericObjectives("keep bundle size under 500kb");
  const metrics = canonicalizeMetrics(objectives, [
    { name: "O1", value: 999, verified: false },
    { name: "bundle size", value: 480, verified: true },
  ]);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].value, 480);
  assert.equal(metrics[0].verified, true);
});

test("canonicalization dedupes metrics that resolve to the same objective", () => {
  const objectives = extractNumericObjectives("keep bundle size under 500kb");
  const metrics = canonicalizeMetrics(objectives, normalizeMetrics([
    { name: "O1", value: 480 },
    { name: "bundle size", value: 481 },
  ]));
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].name, "O1");
  assert.equal(metrics[0].value, 480);
});

test("score entries persist measured metrics, hypothesis, and verdict", () => {
  const result = { score: 50, rawScore: 50, targetScore: 90, baselineScore: null, progressPercent: null, passedDefinition: false, improvement: null, categories: [], blockers: [], strengths: [], nextActions: [], outcome: "needs_iteration", verifierFindings: [] };
  const entry = scoreEntryFromResult(1, "baseline", result, undefined, 1, 1, { metrics: [{ name: "O1", value: 42, unit: "s" }], hypothesis: "parallel suite is faster", verdict: "keep" });
  assert.deepEqual(entry.metrics, [{ name: "O1", value: 42, unit: "s" }]);
  assert.equal(entry.hypothesis, "parallel suite is faster");
  assert.equal(entry.verdict, "keep");
  const empty = scoreEntryFromResult(1, "baseline", result, undefined, 1, 1, { metrics: [] });
  assert.equal(empty.metrics, undefined);
  assert.equal(empty.hypothesis, undefined);
});

test("metric confidence compares best improvement to the noise floor after three runs", () => {
  assert.equal(metricConfidence([100, 90]), null);
  const confident = metricConfidence([100, 98, 99, 70]);
  assert.ok(confident !== null && confident >= 2, `expected >=2x noise, got ${confident}`);
  const lines = metricTrendLines([], [
    { metrics: [{ name: "t", value: 100 }] },
    { metrics: [{ name: "t", value: 98 }] },
    { metrics: [{ name: "t", value: 99 }] },
    { metrics: [{ name: "t", value: 70 }] },
  ]);
  assert.match(lines[0], /confidence \d+(\.\d+)?x noise/);
});
