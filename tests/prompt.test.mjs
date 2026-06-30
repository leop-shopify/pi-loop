import assert from "node:assert/strict";
import { test } from "node:test";

import { continuePrompt, delegationPendingPrompt, kickoffPrompt, missingScorePrompt, nextRunPrompt, systemPromptAddon } from "../extensions/pi-loop/prompt.ts";

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
      attempt: {
        rationale: "Need proof.",
        fullPlan: "Run checks and rescore.",
        actionsTaken: ["inspected scorer", "ran partial checks"],
        acceptanceStatus: "confirmed",
        acceptanceCriteria: ["criteria are confirmed"],
        planTasks: [{ id: "T1", title: "Run checks", status: "in_progress" }],
      },
    }],
  }));

  assert.match(prompt, /Last progress: \+20\.0% over baseline\./);
  assert.match(prompt, /Blockers from feedback scorer:\n- blocker: Missing passed test check/);
  assert.match(prompt, /Next actions from feedback scorer:\n- Verification: add a passed test check/);
  assert.match(prompt, /Progress trend: r1t2:\+20\.0%/);
  assert.match(prompt, /Budget: run 1\/1, turn 1\/5, total turns 0\/5, 30 minute capped timebox/);
  assert.match(prompt, /Bounded research\/delegation rule/);
  assert.match(prompt, /prefer several small read-only research\/review lanes over one broad/);
  assert.match(prompt, /What was tried: inspected scorer; ran partial checks/);
  assert.match(prompt, /What did not improve enough:/);
  assert.match(prompt, /Strategy rule: use ACE context and feedback-scoring output/);
});

test("continue prompt turns review-gate failures into bounded review guidance", () => {
  const prompt = continuePrompt(loopState({
    totalTurnsStarted: 2,
    turnsStarted: 2,
    results: [scoreEntry({
      outcome: "review_gate_failed",
      blockers: [{ severity: "blocker", message: "Required review gate failed: ci." }],
      categories: [{ key: "reviewGates", label: "Automated review gates", score: 0, max: 10, gaps: ["No full CI or merge-blocking gate evidence was provided."] }],
    })],
  }));

  assert.match(prompt, /Review gate recovery:/);
  assert.match(prompt, /Gate blocker: Required review gate failed: ci\./);
  assert.match(prompt, /Gate gap: No full CI or merge-blocking gate evidence was provided\./);
  assert.match(prompt, /passed CI, required, or merge-blocking review gate/);
  assert.match(prompt, /bounded read-only review lane with the failed or missing gate, exact files\/checks/);
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
  assert.match(prompt, /The next feedback checkpoint must show new evidence or explain the blocker; repeated progress is not acceptance/);
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

  assert.match(prompt, /Next actions from feedback scorer:\n- Treat baseline progress as feedback only; choose a materially different next action and score again\./);
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
  assert.match(prompt, /verify one slice, record loop_feedback, and carry unfinished work or partial research into the next feedback attempt\./);
});

test("kickoff prompt starts with acceptance discovery and bounded spawned-agent research guidance", () => {
  const prompt = kickoffPrompt(loopState());

  assert.match(prompt, /First \/loop step: run acceptance discovery before implementation/);
  assert.match(prompt, /agent must decide whether acceptance criteria are present, user-confirmed, and sufficient/);
  assert.match(prompt, /User-provided acceptance bullets are strong signals/);
  assert.match(prompt, /Do not treat agent-invented criteria as final/);
  assert.match(prompt, /ask whether the user owns land, starts from zero or renovation/);
  assert.match(prompt, /use bounded research\/delegation to bring back candidate paths/);
  assert.match(prompt, /Only after the agent judges the user-confirmed criteria sufficient/);
  assert.match(prompt, /acceptanceStatus is confirmed with acceptanceCriteria and planTasks/);
  assert.match(prompt, /Bounded research\/delegation rule/);
  assert.match(prompt, /spawned research agents are allowed and valuable/);
  assert.match(prompt, /delegation itself is not progress evidence/);
  assert.match(prompt, /prefer several small read-only research\/review lanes over one broad/);
  assert.match(prompt, /explicit report deadline before timeout/);
});

test("system prompt advertises acceptance discovery, short capped defaults, and bounded spawned-agent pacing", () => {
  const prompt = systemPromptAddon(loopState({ maxMinutes: 10, maxTurns: 12 }));

  assert.match(prompt, /First \/loop step: run acceptance discovery before implementation/);
  assert.match(prompt, /Defaults are 10 minutes, 12 turns, and 1 run/);
  assert.match(prompt, /minutes are capped at 10/);
  assert.match(prompt, /pi-loop cannot interrupt child agents for you/);
  assert.match(prompt, /spawned agents and data collection are useful but stay inside that cap/);
  assert.match(prompt, /delegation itself is not progress evidence/);
});

test("missing score prompt requests concrete spawned-agent evidence instead of delegation-only scoring", () => {
  const prompt = missingScorePrompt(loopState());

  assert.match(prompt, /do not treat delegation itself as evidence/);
  assert.match(prompt, /completed reports/);
  assert.match(prompt, /concrete partial findings/);
});

test("next run prompt carries bounded research guidance forward", () => {
  const prompt = nextRunPrompt(loopState({ results: [scoreEntry({ turn: 1, score: 70, progressPercent: null })] }));

  assert.match(prompt, /Bounded research\/delegation rule/);
  assert.match(prompt, /move unfinished research into the next feedback attempt/);
});

test("delegation pending prompt refuses to score spawn-only turns", () => {
  const prompt = delegationPendingPrompt(loopState());

  assert.match(prompt, /spawn-only turn is not scoreable progress/);
  assert.match(prompt, /Wait for focused agent reports instead of forcing a score/);
  assert.match(prompt, /lead-owned work that does not duplicate agent scope/);
  assert.match(prompt, /call loop_feedback with a focused checkpoint/);
});

test("next run prompt carries review-gate recovery guidance forward", () => {
  const prompt = nextRunPrompt(loopState({
    results: [scoreEntry({
      outcome: "review_gate_failed",
      blockers: [{ severity: "important", message: "Non-trivial executable change has no automated review gate evidence." }],
      categories: [{ key: "reviewGates", label: "Automated review gates", score: 0, max: 10, gaps: ["No automated review gate evidence was provided for executable changes."] }],
    })],
  }));

  assert.match(prompt, /Review gate recovery:/);
  assert.match(prompt, /record the missing gate as an unresolved feedback blocker/);
  assert.match(prompt, /explicit report deadline before the loop cap/);
});

test("continue prompt keeps legacy acceptance gate open after post-upgrade feedback", () => {
  const prompt = continuePrompt(loopState({
    totalTurnsStarted: 2,
    turnsStarted: 2,
    results: [
      scoreEntry({ turn: 1, attempt: undefined }),
      scoreEntry({
        turn: 2,
        attempt: {
          rationale: "Post-upgrade feedback without acceptance metadata.",
          fullPlan: "Continue existing loop work.",
          acceptanceStatus: "missing",
          acceptanceCriteria: [],
          planTasks: [],
        },
      }),
    ],
  }));

  assert.match(prompt, /^Continue the pi-loop workflow/);
  assert.doesNotMatch(prompt, /Continue the mandatory acceptance-planning step/);
  assert.match(prompt, /Acceptance gate is open from legacy pre-upgrade feedback history/);
});

test("continue prompt carries confirmed acceptance criteria and trackable plan state forward", () => {
  const prompt = continuePrompt(loopState({
    totalTurnsStarted: 1,
    turnsStarted: 1,
    results: [scoreEntry({
      turn: 1,
      score: 70,
      progressPercent: null,
      attempt: {
        rationale: "Need plan state.",
        fullPlan: "T1: inspect current flow [completed]; T2: update prompt [in_progress]",
        acceptanceStatus: "confirmed",
        acceptanceCriteria: ["First loop step discovers acceptance criteria with the user", "Continuation prompts pick the next tracked task after confirmation"],
        planTasks: [
          { id: "T1", title: "Inspect current flow", status: "completed", evidence: "prompt.ts read" },
          { id: "T2", title: "Update kickoff prompt", status: "in_progress" },
          { id: "T3", title: "Verify prompt tests", status: "pending" },
        ],
      },
    })],
  }));

  assert.match(prompt, /Acceptance\/plan state:/);
  assert.match(prompt, /Acceptance status: confirmed/);
  assert.match(prompt, /AC1: First loop step discovers acceptance criteria with the user/);
  assert.match(prompt, /T2: Update kickoff prompt \[in_progress\]/);
  assert.match(prompt, /Plan-guided next prompt rule/);
  assert.match(prompt, /acceptance criteria are already confirmed/);
  assert.match(prompt, /Do not re-run acceptance discovery/);
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
    attempt: {
      rationale: "Need evidence.",
      fullPlan: "Try one path.",
      actionsTaken: ["ran checks"],
      acceptanceStatus: "confirmed",
      acceptanceCriteria: ["criteria are confirmed"],
      planTasks: [{ id: "T1", title: "Do the next verified slice", status: "in_progress" }],
    },
    ...overrides,
  };
}
