import assert from "node:assert/strict";
import { test } from "node:test";

import { formatFeedbackHistory } from "../extensions/pi-loop/feedback-history.ts";

test("feedback history includes trend, best attempt, recent details, and recurring blockers", () => {
  const state = {
    currentRun: 2,
    results: [
      score(1, 1, 70, null, "Missing tests"),
      score(1, 2, 80, 14.3, "Missing tests"),
      score(2, 1, 75, 7.1, "Missing review gate"),
    ],
  };

  const text = formatFeedbackHistory(state);

  assert.match(text, /Progress trend: r1t1:baseline/);
  assert.match(text, /r1t2:\+14\.3%/);
  assert.match(text, /Best attempt: run 1, turn 2, progress \+14\.3%/);
  assert.match(text, /Recent detailed feedback:\n- r2t1 \+7\.1%/);
  assert.match(text, /Recurring blockers: Missing tests \(2\)/);
});

function score(run, turn, value, progressPercent, blocker) {
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
    nextActions: ["fix it"],
    categories: [{ key: "testing", label: "Testing", score: 5, max: 20, gaps: ["Add tests"] }],
  };
}
