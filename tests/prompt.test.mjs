import assert from "node:assert/strict";
import { test } from "node:test";

import { continuePrompt, kickoffPrompt, missingScorePrompt, nextRunPrompt, systemPromptAddon } from "../extensions/pi-loop/prompt.ts";

test("continue prompt includes score, blockers, next actions, and budget", () => {
  const prompt = continuePrompt(loopState({
    totalTurnsStarted: 2,
    turnsStarted: 2,
    results: [{
      type: "score",
      turn: 2,
      timestamp: Date.now(),
      summary: "weak review gates remain",
      score: 72,
      rawScore: 91,
      targetScore: 90,
      baselineScore: 60,
      progressPercent: 20,
      passedDefinition: false,
      improvement: 12,
      blockers: [{ severity: "blocker", message: "Missing passed test check" }],
      nextActions: ["Verification: add a passed test check"],
      categories: [{ key: "verification", label: "Verification", score: 4, max: 12, gaps: ["no passed command"] }],
      attempt: { rationale: "Need proof.", fullPlan: "Run checks and rescore.", actionsTaken: ["inspected scorer", "ran partial checks"] },
    }],
  }));

  assert.match(prompt, /Last progress: \+20\.0% over baseline\./);
  assert.match(prompt, /Blockers from scorer:\n- blocker: Missing passed test check/);
  assert.match(prompt, /Next actions from scorer:\n- Verification: add a passed test check/);
  assert.match(prompt, /Progress trend: r1t2:\+20\.0%/);
  assert.match(prompt, /Budget: run 1\/1, turn 3\/5, total turns 2\/5, 30 minute capped timebox/);
  assert.match(prompt, /Bounded research\/delegation rule/);
  assert.match(prompt, /pi-loop cannot interrupt child agents for you/);
  assert.match(prompt, /What was tried: inspected scorer; ran partial checks/);
  assert.match(prompt, /What did not improve enough:/);
  assert.match(prompt, /Strategy rule: use ACE context and scorer feedback/);
});

test("continue prompt calls out repeated progress as plateau and rejects heuristic satisfaction", () => {
  const prompt = continuePrompt(loopState({
    totalTurnsStarted: 3,
    turnsStarted: 3,
    results: [scoreEntry({ turn: 1, score: 60, progressPercent: null, summary: "baseline" }), scoreEntry({ turn: 2, score: 80, progressPercent: 50, summary: "added tests", passedDefinition: true }), scoreEntry({ turn: 3, score: 80, progressPercent: 50, summary: "reran same checks", passedDefinition: false, improvement: 0 })],
  }));

  assert.match(prompt, /Plateau\/repeat signal: progress repeated the previous value \(\+50\.0% over baseline\)/);
  assert.match(prompt, /score did not improve over the previous attempt \(80 <= 80\)/);
  assert.match(prompt, /score did not beat the best prior attempt \(80 <= 80\)/);
  assert.match(prompt, /The next score must show new evidence or explain the blocker; repeated progress is not acceptance/);
  assert.match(prompt, /Progress is feedback only/);
});

test("continue prompt rewrites stale stop-on-progress scorer actions", () => {
  const prompt = continuePrompt(loopState({
    totalTurnsStarted: 2,
    turnsStarted: 2,
    results: [scoreEntry({
      turn: 2,
      score: 80,
      progressPercent: 50,
      summary: "old scorer feedback",
      nextActions: ["Baseline recorded; run another loop turn and verify percent improvement before stopping."],
    })],
  }));

  assert.match(prompt, /Next actions from scorer:\n- Treat baseline progress as feedback only; choose a materially different next action and score again\./);
  assert.doesNotMatch(prompt, /verify percent improvement before stopping/);
});

test("continue prompt includes ACE context when provided", () => {
  const prompt = continuePrompt(loopState({
    totalTurnsStarted: 1,
    turnsStarted: 1,
    results: [scoreEntry({ turn: 1, score: 70, progressPercent: null })],
  }), { aceContext: "## ACE Loop Context\n\nPrefer short verifiable slices." });

  assert.match(prompt, /## ACE Loop Context/);
  assert.match(prompt, /Prefer short verifiable slices\./);
  assert.match(prompt, /verify one slice, score it, and carry unfinished work or partial research into the next scored attempt\./);
});

test("kickoff prompt includes bounded spawned-agent research guidance", () => {
  const prompt = kickoffPrompt(loopState());

  assert.match(prompt, /Bounded research\/delegation rule/);
  assert.match(prompt, /spawned research agents are allowed and valuable/);
  assert.match(prompt, /explicit report deadline before timeout/);
  assert.match(prompt, /Score available findings instead of waiting longer/);
});

test("system prompt advertises short capped defaults and bounded spawned-agent pacing", () => {
  const prompt = systemPromptAddon(loopState({ maxMinutes: 10, maxTurns: 12 }));

  assert.match(prompt, /Defaults are 10 minutes, 12 turns, and 1 run/);
  assert.match(prompt, /minutes are capped at 10/);
  assert.match(prompt, /pi-loop cannot interrupt child agents for you/);
  assert.match(prompt, /spawned agents and data collection are useful but stay inside that cap/);
});

test("missing score prompt requests available spawned-agent evidence instead of waiting", () => {
  const prompt = missingScorePrompt(loopState());

  assert.match(prompt, /request a current report now and score what is available/);
  assert.match(prompt, /partial findings/);
  assert.match(prompt, /instead of waiting longer/);
});

test("next run prompt carries bounded research guidance forward", () => {
  const prompt = nextRunPrompt(loopState({ results: [scoreEntry({ turn: 1, score: 70, progressPercent: null })] }));

  assert.match(prompt, /Bounded research\/delegation rule/);
  assert.match(prompt, /move unfinished research into the next scored attempt/);
});

test("continue prompt includes plateau analysis from feedback history", () => {
  const prompt = continuePrompt(loopState({
    totalTurnsStarted: 4,
    turnsStarted: 4,
    results: [
      scoreEntry({ turn: 1, score: 80, progressPercent: 0 }),
      scoreEntry({ turn: 2, score: 81, progressPercent: 0 }),
      scoreEntry({ turn: 3, score: 81, progressPercent: 0 }),
      scoreEntry({ turn: 4, score: 81, progressPercent: 0 }),
    ],
  }));

  assert.match(prompt, /Plateau analysis: 0\.0% repeated for 4 consecutive attempts; branch to a different strategy or add new evidence\./);
  assert.match(prompt, /Best attempt to beat: run 1, turn 4, score 81, progress 0\.0% over baseline\./);
});

function loopState(overrides = {}) {
  return {
    active: true,
    goal: "harden scorer",
    targetScore: 90,
    maxTurns: 5,
    maxMinutes: 30,
    maxRuns: 1,
    currentRun: 1,
    totalTurnsStarted: 0,
    startedAt: Date.now(),
    turnsStarted: 0,
    lastAgentStartScoreCount: 0,
    unscoredConsecutiveTurns: 0,
    pendingResumeTimer: null,
    stopReason: null,
    targetContext: null,
    runs: [{ index: 1, startedAt: Date.now(), turnsStarted: overrides.turnsStarted ?? 0 }],
    prematureStopCount: 0,
    currentPrompt: null,
    currentTurnStartedAt: null,
    lastTurnDurationMs: null,
    turnDurations: [],
    contextUsage: null,
    results: [],
    ...overrides,
  };
}

function scoreEntry(overrides = {}) {
  return {
    type: "score",
    run: 1,
    turn: 1,
    timestamp: Date.now(),
    summary: "attempt",
    score: 60,
    rawScore: 60,
    targetScore: 90,
    baselineScore: 60,
    progressPercent: null,
    passedDefinition: false,
    improvement: null,
    blockers: [],
    nextActions: ["Try a different proof path"],
    categories: [{ key: "testing", label: "Testing", score: 12, max: 20, gaps: ["edge coverage missing"] }],
    attempt: { rationale: "Need evidence.", fullPlan: "Try one path.", actionsTaken: ["ran checks"] },
    ...overrides,
  };
}
