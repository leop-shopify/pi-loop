const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename);
const { promptRichness, shouldSuggestMode } = jiti("../extensions/pi-loop/plan/intent-advisor.ts");

const richPrompt = `Review the current extension and separate its responsibilities.

Requirements:
1. Persistent objectives must move to pi-goal.
2. The loop must only run scheduled tasks.
3. Preserve existing session state where safe.
4. Add tests proving no competing continuation is queued.

Research the official agent guidance first, propose a design, implement it, and verify the package checks. Avoid silently changing old command meaning.`;

test("rich multi-part prompts are eligible for a mode suggestion", () => {
	const richness = promptRichness(richPrompt);
	assert.ok(richness.score >= 4, JSON.stringify(richness));
	assert.equal(
		shouldSuggestMode({
			text: richPrompt,
			source: "interactive",
			hasUI: true,
			streamingBehavior: undefined,
			imageCount: 0,
			busy: false,
			enabled: true,
		}),
		true,
	);
});

test("simple prompts and explicit mode requests are not intercepted", () => {
	for (const text of [
		"Fix the typo in README.md",
		"/goal finish the migration",
		"Plan this migration before coding",
		"Run this every 5 minutes",
		"Schedule a daily review",
	]) {
		assert.equal(
			shouldSuggestMode({ text, source: "interactive", hasUI: true, imageCount: 0, busy: false, enabled: true }),
			false,
			text,
		);
	}
});

test("common explicit Goal and scheduling phrasings bypass the advisor even when rich", () => {
	for (const prefix of [
		"Create a goal to complete this migration.",
		"Please use /goal for this migration.",
		"Please run these checks every weekday at 9am.",
		"Create a scheduled task to run these checks every weekday.",
		"Set up a scheduled task to run this daily.",
		"Add a scheduled task that runs every day.",
		"I want to schedule this every weekday.",
		"I want a scheduled task to run every weekday.",
		"I want this scheduled every weekday.",
	]) {
		const text = `${prefix}\n\n${richPrompt}`;
		assert.equal(
			shouldSuggestMode({ text, source: "interactive", hasUI: true, imageCount: 0, busy: false, enabled: true }),
			false,
			prefix,
		);
	}
});

test("extension input, streaming input, no-UI input, and busy modes are skipped", () => {
	const base = { text: richPrompt, source: "interactive", hasUI: true, imageCount: 0, busy: false, enabled: true };
	assert.equal(shouldSuggestMode({ ...base, source: "extension" }), false);
	assert.equal(shouldSuggestMode({ ...base, streamingBehavior: "steer" }), false);
	assert.equal(shouldSuggestMode({ ...base, hasUI: false }), false);
	assert.equal(shouldSuggestMode({ ...base, busy: true }), false);
	assert.equal(shouldSuggestMode({ ...base, enabled: false }), false);
});

test("commands, shell input, and images without enough text are skipped", () => {
	const base = { source: "interactive", hasUI: true, imageCount: 0, busy: false, enabled: true };
	assert.equal(shouldSuggestMode({ ...base, text: "/review" }), false);
	assert.equal(shouldSuggestMode({ ...base, text: "!git status" }), false);
	assert.equal(shouldSuggestMode({ ...base, text: "check this", imageCount: 1 }), false);
});
