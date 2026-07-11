import assert from "node:assert/strict";
import { test } from "node:test";

import { continuePrompt, nextRunPrompt, systemPromptAddon } from "../extensions/pi-loop/prompt.ts";
import { completionClaimed, confirmationPassCount, createLoopState } from "../extensions/pi-loop/state.ts";

function scoreEntry(overrides = {}) {
  const { attempt, ...rest } = overrides;
  return {
    type: "score",
    run: 1,
    turn: 2,
    globalTurn: 2,
    timestamp: Date.now(),
    summary: "house scene built",
    score: 70,
    rawScore: 80,
    targetScore: 90,
    baselineScore: 60,
    progressPercent: 16.7,
    passedDefinition: false,
    improvement: 10,
    blockers: [],
    nextActions: [],
    categories: [],
    attempt: {
      rationale: "done",
      fullPlan: "build the house",
      actionsTaken: ["built scene"],
      acceptanceStatus: "confirmed",
      acceptanceCriteria: ["house renders with walls, roof, door", "user can orbit the camera", "page loads without console errors"],
      planTasks: [
        { id: "T1", title: "Model the house", status: "completed", evidence: "scene renders" },
        { id: "T2", title: "Add camera controls", status: "completed", evidence: "orbit works" },
      ],
      stopIntent: "claim_done",
      ...attempt,
    },
    ...rest,
  };
}

function claimedState(results = [scoreEntry()]) {
  const state = createLoopState();
  state.active = true;
  state.goal = "build me a virtual house";
  state.turnsStarted = results.length;
  state.totalTurnsStarted = results.length;
  state.results = results;
  return state;
}

test("completionClaimed requires claim_done, confirmed criteria, and fully completed tasks", () => {
  assert.equal(completionClaimed(claimedState()), true);
  assert.equal(completionClaimed(claimedState([scoreEntry({ attempt: { stopIntent: "continue" } })])), false);
  assert.equal(completionClaimed(claimedState([scoreEntry({ attempt: { planTasks: [{ id: "T1", title: "Model the house", status: "pending" }] } })])), false);
  assert.equal(completionClaimed(createLoopState()), false);
});

test("confirmation pass count follows the trailing claim streak", () => {
  assert.equal(confirmationPassCount(claimedState()), 1);
  assert.equal(confirmationPassCount(claimedState([scoreEntry(), scoreEntry({ turn: 3, globalTurn: 3 })])), 2);
  assert.equal(confirmationPassCount(claimedState([scoreEntry(), scoreEntry({ turn: 3, globalTurn: 3, attempt: { stopIntent: "continue" } })])), 0);
});

test("after a completion claim the continue prompt becomes a confirmation pass", () => {
  const prompt = continuePrompt(claimedState());
  assert.match(prompt, /confirmation pass #1/);
  assert.match(prompt, /AC1: house renders with walls, roof, door/);
  assert.match(prompt, /try to falsify the claim/);
  assert.match(prompt, /Do not add features, refactors, or new scope/);
  assert.doesNotMatch(prompt, /Continue the pi-loop workflow with a refined prompt/);
  assert.doesNotMatch(prompt, /choose a genuinely different, verifiable slice after failure or plateau/);
});

test("later confirmation passes ask for a different falsification angle", () => {
  const prompt = continuePrompt(claimedState([scoreEntry(), scoreEntry({ turn: 3, globalTurn: 3 })]));
  assert.match(prompt, /confirmation pass #2/);
  assert.match(prompt, /already survived at least one confirmation pass/);
});

test("a failed confirmation reopens normal iteration", () => {
  const state = claimedState([
    scoreEntry(),
    scoreEntry({ turn: 3, globalTurn: 3, attempt: { stopIntent: "continue", planTasks: [{ id: "T2", title: "Add camera controls", status: "in_progress" }] } }),
  ]);
  assert.equal(completionClaimed(state), false);
  const prompt = continuePrompt(state);
  assert.match(prompt, /refined prompt, not a passive retry/);
  assert.doesNotMatch(prompt, /confirmation pass/);
});

test("next run after a claim becomes an independent audit run", () => {
  const prompt = nextRunPrompt(claimedState());
  assert.match(prompt, /independent confirmation audit/);
  assert.match(prompt, /re-verify every confirmed acceptance criterion with fresh evidence/);
  assert.doesNotMatch(prompt, /genuinely different, verifiable slice/);

  const normal = nextRunPrompt(claimedState([scoreEntry({ attempt: { stopIntent: "continue" } })]));
  assert.match(normal, /genuinely different, verifiable slice/);
});

test("confirmation passes ask for an independent audit lane", () => {
  const prompt = continuePrompt(claimedState());
  assert.match(prompt, /independent audit lane/);
  assert.match(prompt, /treat its report as review evidence/);
});

test("system prompt addon re-injects criteria and plan state every turn once recorded", () => {
  const state = claimedState();
  const addon = systemPromptAddon(state);
  assert.match(addon, /AC1: house renders with walls, roof, door/);
  assert.match(addon, /T1: Model the house \[completed\]/);

  const fresh = createLoopState();
  fresh.goal = "build me a virtual house";
  assert.doesNotMatch(systemPromptAddon(fresh), /Acceptance\/plan state/);
});

test("system prompt addon flags an active confirmation", () => {
  assert.match(systemPromptAddon(claimedState()), /completion claim is currently under confirmation/);
  assert.doesNotMatch(systemPromptAddon(claimedState([scoreEntry({ attempt: { stopIntent: "continue" } })])), /under confirmation/);
});
