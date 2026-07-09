export type InputSource = "interactive" | "rpc" | "extension";

export type SuggestionInput = {
	text: string;
	source: InputSource;
	hasUI: boolean;
	streamingBehavior?: "steer" | "followUp";
	imageCount: number;
	busy: boolean;
	enabled: boolean;
};

export type PromptRichness = {
	score: number;
	signals: string[];
};

const EXPLICIT_MODE = [
	/^\s*[\/]?(?:goal|plan|loop)\b/i,
	/\/(?:goal|plan|loop)\b/i,
	/^\s*(?:please\s+)?(?:create|make|turn|set|start|run)\s+(?:this|it|the request)?\s*(?:as|into|to)?\s*(?:a\s+)?goal\b/i,
	/\b(?:create|write|make|give me)\s+(?:an?\s+)?(?:implementation\s+)?plan\b/i,
	/\bplan\s+(?:this|it|the work|before coding|before implementing)\b/i,
	/\b(?:goal|plan)\s+mode\b/i,
	/^\s*(?:please\s+)?(?:schedule\b|i\s+want\s+(?:to\s+schedule\b|(?:a\s+)?scheduled\s+task\b|this\s+scheduled\b)|(?:create|add|set\s+up)\s+(?:a\s+)?(?:recurring|scheduled\s+task)\b|run\b.*\bevery\s+(?:\d+\s*(?:m|h|d|minutes?|hours?|days?)|weekday|day|week|month)\b)/i,
];

export function promptRichness(text: string): PromptRichness {
	const normalized = text.trim();
	const signals: string[] = [];
	let score = 0;
	if (normalized.length >= 200) {
		score++;
		signals.push("substantial length");
	}
	if (normalized.length >= 400) {
		score++;
		signals.push("long-form detail");
	}
	if (normalized.split(/\n\s*\n/).filter(Boolean).length >= 2) {
		score++;
		signals.push("multiple sections");
	}
	if ((normalized.match(/^\s*(?:[-*]|\d+[.)])\s+/gm) ?? []).length >= 3) {
		score += 2;
		signals.push("structured requirements");
	}
	if (uniqueMatches(normalized, /\b(must|should|need|want|require|acceptance|done|verify|test|constraint|preserve|avoid|risk|blocked)\w*\b/gi) >= 3) {
		score++;
		signals.push("constraints and verification");
	}
	if (uniqueMatches(normalized, /\b(review|research|investigate|design|implement|migrate|build|add|remove|fix|refactor|document|verify|test)\w*\b/gi) >= 3) {
		score++;
		signals.push("multiple work phases");
	}
	if ((normalized.match(/(?:https?:\/\/\S+|(?:^|\s)[.@~]?[\w-]+\/[\w./-]+|#[0-9]+)/g) ?? []).length >= 2) {
		score++;
		signals.push("multiple concrete references");
	}
	return { score, signals };
}

export function shouldSuggestMode(input: SuggestionInput): boolean {
	const text = input.text.trim();
	if (!input.enabled || !input.hasUI || input.busy) return false;
	if (input.source !== "interactive" || input.streamingBehavior) return false;
	if (!text || text.startsWith("/") || text.startsWith("!")) return false;
	if (EXPLICIT_MODE.some((pattern) => pattern.test(text))) return false;
	if (text.length < 160) return false;
	return promptRichness(text).score >= 4;
}

function uniqueMatches(text: string, pattern: RegExp): number {
	return new Set([...text.matchAll(pattern)].map((match) => match[0].toLowerCase())).size;
}
