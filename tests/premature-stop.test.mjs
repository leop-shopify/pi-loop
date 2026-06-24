import assert from "node:assert/strict";
import { test } from "node:test";

import { assistantTextFromEvent, hasCompletionClaim, prematureStopPrompt } from "../extensions/pi-loop/premature-stop.ts";

test("completion-claim detection is conservative", () => {
  assert.equal(hasCompletionClaim("Done"), true);
  assert.equal(hasCompletionClaim("All set, ready for review"), true);
  assert.equal(hasCompletionClaim("not done yet"), false);
  assert.equal(hasCompletionClaim("This is not complete"), false);
});

test("assistant text extraction reads assistant messages only", () => {
  const text = assistantTextFromEvent({ messages: [{ role: "user", content: "Done" }, { role: "assistant", content: [{ type: "text", text: "All set" }] }] });

  assert.equal(text, "All set");
});

test("premature-stop prompt rejects completion claims before verified improvement", () => {
  const prompt = prematureStopPrompt({ results: [{ score: 72, targetScore: 90 }] });

  assert.match(prompt, /claimed completion/);
  assert.match(prompt, /baseline recorded/);
  assert.match(prompt, /verified improvement/);
  assert.match(prompt, /rejected/);
});
