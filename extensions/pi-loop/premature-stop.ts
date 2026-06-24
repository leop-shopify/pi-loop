import type { LoopRuntimeState } from "./state.ts";

const COMPLETION_CLAIM = /\b(done|all set|completed|complete|ready for review|no further work|nothing else to do)\b/i;
const NEGATED = /\b(not|isn't|is not|aren't|are not|wasn't|was not|don't|do not)\s+(done|complete|completed|ready)\b/i;

export function assistantTextFromEvent(event: unknown): string {
  const messages = (event as { messages?: unknown[] })?.messages;
  if (!Array.isArray(messages)) return "";
  return messages.map(messageText).filter(Boolean).join("\n");
}

export function hasCompletionClaim(text: string): boolean {
  if (!text.trim()) return false;
  if (NEGATED.test(text)) return false;
  return COMPLETION_CLAIM.test(text);
}

export function missingScoreReason(claimedCompletion: boolean): string {
  return claimedCompletion ? "completion claimed without scoring" : "score tool was not called";
}

export function prematureStopPrompt(state: LoopRuntimeState): string {
  const last = state.results[state.results.length - 1];
  return [
    "The previous turn claimed completion, but the loop has not verified improvement yet.",
    `Last progress: ${last ? (last.progressPercent === null || last.progressPercent === undefined ? "baseline recorded" : `${last.progressPercent > 0 ? "+" : ""}${last.progressPercent.toFixed(1)}% over baseline`) : "none"}`,
    "Treat the completion claim as rejected. Continue from the scorer feedback, resolve blockers, improve on the prior score, and call score_loop_result again before claiming completion.",
  ].join("\n\n");
}

function messageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (!message || typeof message !== "object") return "";
  const record = message as { role?: string; content?: unknown; text?: unknown };
  if (record.role && record.role !== "assistant") return "";
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) return record.content.map(partText).join("\n");
  return "";
}

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  if (!part || typeof part !== "object") return "";
  const record = part as { type?: string; text?: unknown };
  return record.type === "text" && typeof record.text === "string" ? record.text : "";
}
