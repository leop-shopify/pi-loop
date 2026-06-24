import { buildCaps } from "./caps.ts";
import { scoreCorrectness, scoreDesign, scoreOperability, scoreRails, scoreReviewGates, scoreTesting, scoreVerification } from "./categories/index.ts";
import { clamp } from "./evidence.ts";
import { verifierFindingCaps, verifyScoreEvidence } from "./evidence-verifier.ts";
import { classifyOutcome } from "./outcome.ts";
import { DEFAULT_TARGET_SCORE } from "./rubric.ts";
import type { RuleRegistry } from "./rules/index.ts";
import type { Cap, CategoryScore, LoopScoreInput, LoopScoreResult, RiskSeverity, ScoreBlocker } from "./types.ts";

export interface ScoreLoopOptions {
  cwd?: string;
}

export function scoreLoopResult(input: LoopScoreInput, ruleRegistry?: RuleRegistry, options: ScoreLoopOptions = {}): LoopScoreResult {
  const targetScore = clamp(Math.round(input.targetScore ?? DEFAULT_TARGET_SCORE), 1, 100);
  const categories = scoreCategories(input);
  const rawScore = categories.reduce((sum, item) => sum + item.score, 0);
  const verifierFindings = verifyScoreEvidence(input, { cwd: options.cwd });
  const caps = [...buildCaps(input, ruleRegistry), ...verifierFindingCaps(verifierFindings)];
  const cap = caps.length > 0 ? Math.min(...caps.map((item) => item.value)) : 100;
  const score = clamp(Math.min(rawScore, cap), 0, 100);
  const blockers = buildBlockers(input, caps, categories);
  const hardBlockers = blockers.filter((blocker) => blocker.severity === "blocker");
  const previousScore = typeof input.previousScore === "number" ? input.previousScore : null;
  const baselineScore = typeof input.baselineScore === "number" ? input.baselineScore : null;
  const improvement = previousScore === null ? null : score - previousScore;
  const progress = progressOverBaseline(score, baselineScore);

  const result = {
    score,
    rawScore,
    targetScore,
    baselineScore,
    progressPercent: progress,
    passedDefinition: baselineScore !== null && progress !== null && progress > 0 && hardBlockers.length === 0,
    improvement,
    categories,
    blockers,
    strengths: buildStrengths(categories),
    nextActions: buildNextActions(categories, blockers, baselineScore, progress),
    verifierFindings,
  };

  return { ...result, outcome: classifyOutcome(input, result, verifierFindings) };
}

function scoreCategories(input: LoopScoreInput): CategoryScore[] {
  return [
    scoreCorrectness(input),
    scoreTesting(input),
    scoreDesign(input),
    scoreRails(input),
    scoreVerification(input),
    scoreReviewGates(input),
    scoreOperability(input),
  ];
}

function progressOverBaseline(score: number, baselineScore: number | null): number | null {
  if (baselineScore === null) return null;
  if (baselineScore === 0) return score === 0 ? 0 : 100;
  return Math.round(((score - baselineScore) / Math.abs(baselineScore)) * 1000) / 10;
}

function formatProgress(value: number | null): string {
  if (value === null) return "n/a";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function buildBlockers(input: LoopScoreInput, caps: Cap[], categories: CategoryScore[]): ScoreBlocker[] {
  const blockers: ScoreBlocker[] = [];

  for (const cap of caps) {
    const severity: RiskSeverity = cap.value <= 65 ? "blocker" : "important";
    blockers.push({ severity, message: cap.reason, evidence: cap.evidence });
  }

  for (const risk of input.risks ?? []) {
    if (!risk.resolved) blockers.push({ severity: risk.severity, message: risk.description, evidence: risk.evidence });
  }

  for (const categoryScore of categories) {
    if (categoryScore.score / categoryScore.max < 0.5) blockers.push({ severity: "important", message: `${categoryScore.label} is under half score.` });
  }

  return dedupeBlockers(blockers);
}

function dedupeBlockers(blockers: ScoreBlocker[]): ScoreBlocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.severity}:${blocker.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildStrengths(categories: CategoryScore[]): string[] {
  return categories
    .filter((categoryScore) => categoryScore.score / categoryScore.max >= 0.8)
    .map((categoryScore) => `${categoryScore.label}: ${categoryScore.score}/${categoryScore.max}`);
}

function buildNextActions(categories: CategoryScore[], blockers: ScoreBlocker[], baselineScore: number | null, progress: number | null): string[] {
  const actions: string[] = [];

  if (baselineScore === null) actions.push("Baseline recorded; run another loop turn and verify percent improvement before stopping.");
  else if (progress === null || progress <= 0) actions.push(`Improve over the baseline attempt; current progress is ${formatProgress(progress)}.`);

  for (const blocker of blockers.filter((item) => item.severity === "blocker")) actions.push(`Resolve blocker: ${blocker.message}`);
  for (const categoryScore of categories) {
    if (categoryScore.score / categoryScore.max >= 0.8) continue;
    const gap = categoryScore.gaps[0];
    actions.push(gap ? `${categoryScore.label}: ${gap}` : `Improve ${categoryScore.label}.`);
  }

  return [...new Set(actions)].slice(0, 8);
}
