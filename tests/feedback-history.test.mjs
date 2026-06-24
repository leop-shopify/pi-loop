import assert from "node:assert/strict";
import { test } from "node:test";

import { formatFeedbackHistory } from "../extensions/pi-loop/feedback-history.ts";

test("feedback history includes trend, best attempt, refined actions, recent details, and recurring blockers", () => {
  const state = {
    currentRun: 2,
    results: [
      score(1, 1, 70, null, "Missing tests", "Run tests"),
      score(1, 2, 80, 14.3, "No remote CI has run", "Baseline recorded; run another loop turn and verify percent improvement before stopping."),
      score(2, 1, 75, 7.1, "Remote CI has not run", "Run smoke"),
    ],
  };

  const text = formatFeedbackHistory(state);

  assert.match(text, /Progress trend: r1t1:baseline/);
  assert.match(text, /r1t2:\+14\.3%/);
  assert.match(text, /Best attempt: run 1, turn 2, progress \+14\.3%/);
  assert.match(text, /Top next actions: Treat baseline progress as feedback only/);
  assert.match(text, /Recent detailed feedback:\n- r2t1 \+7\.1%/);
  assert.match(text, /Recurring blockers: No remote CI has run \(2\); Missing tests \(1\)/);
});

test("feedback history breaks progress ties with score and recency", () => {
  const state = {
    currentRun: 1,
    results: [
      score(1, 1, 80, 0, "Remote CI has not run", "first plan"),
      score(1, 2, 81, 0, "Remote CI has not run", "higher score"),
      score(1, 3, 81, 0, "Remote CI has not run", "latest equal score"),
    ],
  };

  const text = formatFeedbackHistory(state);

  assert.match(text, /Plateau analysis: 0\.0% repeated for 3 consecutive attempts; branch to a different strategy or add new evidence\./);
  assert.match(text, /Best attempt: run 1, turn 3, progress 0\.0%/);
  assert.match(text, /Top next actions: latest equal score/);
});

test("feedback history rewrites stale baseline-chasing next actions", () => {
  const state = {
    currentRun: 1,
    results: [score(1, 1, 80, 0, "Remote CI has not run", "Improve over the baseline attempt; current progress is 0.0%.")],
  };

  const text = formatFeedbackHistory(state);

  assert.match(text, /Top next actions: Treat baseline progress as feedback only; choose a materially different next action and score again\./);
  assert.doesNotMatch(text, /Improve over the baseline attempt/);
});

function score(run, turn, value, progressPercent, blocker, nextAction = "fix it") {
  return {
    type: "score",
    run,
    turn,
    globalTurn: turn,
    timestamp: Date.now(),
    summary: `score ${value}`,
    score: value,
    rawScore: value,
    targetScore: 90,
    baselineScore: 70,
    progressPercent,
    passedDefinition: false,
    improvement: null,
    blockers: [{ severity: "blocker", message: blocker }],
    nextActions: [nextAction],
    categories: [{ key: "testing", label: "Testing", score: 5, max: 20, gaps: ["Add tests"] }],
  };
}
