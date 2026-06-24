import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_TOTAL_TURNS } from "../extensions/pi-loop/constants.ts";
import { bestScoreReason, canStartNextRun, markCurrentRunStopped, startNextRun, totalTurnBudgetExceeded } from "../extensions/pi-loop/run-manager.ts";
import { createLoopState, scoreEntryFromResult, startLoopState } from "../extensions/pi-loop/state.ts";
import { scoreLoopResult } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

test("run manager advances sequential runs and reports best score", () => {
  const state = createLoopState();
  startLoopState(state, { goal: "best of k", targetScore: 95, maxTurns: 1, maxMinutes: 60, maxRuns: 2 });
  const result = scoreLoopResult({ ...strongInput, targetScore: 95, requirements: [{ description: "missing", status: "missing" }] });
  state.results.push(scoreEntryFromResult(1, "weak", result, strongInput.attempt, 1, 1));
  state.turnsStarted = 1;
  state.totalTurnsStarted = 1;

  assert.equal(canStartNextRun(state), true);
  markCurrentRunStopped(state, "turn limit reached", 10);
  startNextRun(state, 20);

  assert.equal(state.currentRun, 2);
  assert.equal(state.turnsStarted, 0);
  assert.equal(state.runs[0].stopReason, "turn limit reached");
  assert.match(bestScoreReason(state), /best progress baseline from run 1/);
});

test("total turn budget rejects oversized best-of-k loops", () => {
  assert.equal(totalTurnBudgetExceeded(5, Math.floor(MAX_TOTAL_TURNS / 5)), false);
  assert.equal(totalTurnBudgetExceeded(5, Math.floor(MAX_TOTAL_TURNS / 5) + 1), true);
});
