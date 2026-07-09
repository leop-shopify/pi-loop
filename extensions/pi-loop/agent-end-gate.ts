import { isContextOverflow } from "@earendil-works/pi-ai";
import type { AgentEndEvent, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const AGENT_END_SETTLE_MS = 15_000;
export const COMPACTION_SETTLE_MS = 120_000;

type Timer = ReturnType<typeof setTimeout>;
type TerminalHandler = () => void | Promise<void>;

type AgentEndGateOptions = {
  settleMs?: number;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

export type AgentEndGate = {
  defer(event: AgentEndEvent, ctx: ExtensionContext, handler: TerminalHandler): Promise<void>;
  consumeRetryStart(): boolean;
  compactionStarted(willRetry: boolean): void;
  compactionFinished(willRetry: boolean): void;
  cancel(): void;
};

export function createAgentEndGate(options: AgentEndGateOptions = {}): AgentEndGate {
  const settleMs = options.settleMs ?? AGENT_END_SETTLE_MS;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? clearTimeout;
  let pending: { event: AgentEndEvent; handlers: TerminalHandler[]; timer: Timer } | null = null;

  function cancel(): void {
    if (!pending) return;
    clearTimer(pending.timer);
    pending = null;
  }

  function rearm(delay: number): void {
    if (!pending) return;
    clearTimer(pending.timer);
    const timer = setTimer(flush, delay);
    if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
    pending.timer = timer;
  }

  function flush(): void {
    if (!pending) return;
    const handlers = pending.handlers;
    clearTimer(pending.timer);
    pending = null;
    for (const handler of handlers) void Promise.resolve(handler());
  }

  return {
    async defer(event, _ctx, handler) {
      if (!isRetryCandidate(event, _ctx.model?.contextWindow)) {
        await handler();
        return;
      }
      if (pending && pending.event !== event) flush();
      if (!pending) {
        const timer = setTimer(flush, settleMs);
        if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
        pending = { event, handlers: [], timer };
      }
      pending.handlers.push(handler);
    },
    consumeRetryStart() {
      if (!pending) return false;
      cancel();
      return true;
    },
    compactionStarted(willRetry) {
      if (!pending) return;
      if (willRetry) rearm(COMPACTION_SETTLE_MS);
      else flush();
    },
    compactionFinished(willRetry) {
      if (!pending) return;
      if (willRetry) rearm(settleMs);
      else flush();
    },
    cancel,
  };
}

export function isRetryCandidate(event: AgentEndEvent, contextWindow?: number): boolean {
  const assistant = [...(event.messages ?? [])].reverse().find((message) => message.role === "assistant") as any;
  if (!assistant) return false;
  if ((assistant.stopReason === "error" || assistant.usage) && isContextOverflow(assistant, contextWindow)) return true;
  if (assistant.stopReason !== "error" || !assistant.errorMessage) return false;
  if (/GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i.test(assistant.errorMessage)) return false;
  return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated|retry delay|context.*(?:window|length|overflow)|too many tokens|prompt is too long|maximum context/i.test(assistant.errorMessage);
}
