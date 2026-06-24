import assert from "node:assert/strict";
import { test } from "node:test";

import { formatFeedbackHistory } from "../extensions/pi-loop/feedback-history.ts";

test("feedback history includes trend, best attempt, recent details, and recurring blockers", () => {
  const state = {
    currentRun: 2,
    results: [
      score(1, 1, 70, "Missing tests"),
      score(1, 2, 80, "Missing tests"),
      score(2, 1, 75, "Missing review gate"),
    ],
  };

  const text = formatFeedbackHistory(state);

  assert.match(text, /Score trend: r1t1:70\/90/);
  assert.match(text, /Best attempt: run 1, turn 2, score 80\/90/);
  assert.match(text, /Recent detailed feedback:\n- r2t1 75\/90/);
  assert.match(text, /Recurring blockers: Missing tests \(2\)/);
});

function score(run, turn, value, blocker) {
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
    passedDefinition: false,
    improvement: null,
    blockers: [{ severity: "blocker", message: blocker }],
    nextActions: ["fix it"],
    categories: [{ key: "testing", label: "Testing", score: 5, max: 20, gaps: ["Add tests"] }],
  };
}
