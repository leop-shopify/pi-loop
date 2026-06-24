import assert from "node:assert/strict";
import { test } from "node:test";

import { continuePrompt } from "../extensions/pi-loop/prompt.ts";

test("continue prompt includes score, blockers, next actions, and budget", () => {
  const prompt = continuePrompt({
    active: true,
    goal: "harden scorer",
    targetScore: 90,
    maxTurns: 5,
    maxMinutes: 30,
    maxRuns: 1,
    currentRun: 1,
    totalTurnsStarted: 2,
    startedAt: Date.now(),
    turnsStarted: 2,
    lastAgentStartScoreCount: 0,
    unscoredConsecutiveTurns: 0,
    pendingResumeTimer: null,
    stopReason: null,
    targetContext: null,
    runs: [{ index: 1, startedAt: Date.now(), turnsStarted: 2 }],
    prematureStopCount: 0,
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
      categories: [{ key: "verification", score: 4, max: 12 }],
    }],
  });

  assert.match(prompt, /Last progress: \+20\.0% over baseline\./);
  assert.match(prompt, /Blockers from scorer:\n- blocker: Missing passed test check/);
  assert.match(prompt, /Next actions from scorer:\n- Verification: add a passed test check/);
  assert.match(prompt, /Progress trend: r1t2:\+20\.0%/);
  assert.match(prompt, /Budget: run 1\/1, turn 3\/5, total turns 2\/5, 30 minute global timebox/);
});
