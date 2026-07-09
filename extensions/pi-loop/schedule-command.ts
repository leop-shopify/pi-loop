export type ScheduleCommand =
  | { command: "create"; intervalMs: number; prompt: string }
  | { command: "status" }
  | { command: "clear" }
  | { command: "help" }
  | { command: "pause" | "resume" | "cancel" | "run"; id: string }
  | { command: "goal_migration"; objective: string }
  | { command: "error"; message: string };

const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 6 * 24 * 60 * 60 * 1_000;

export function parseScheduleCommand(input: string): ScheduleCommand {
  const trimmed = input.trim();
  if (!trimmed || trimmed === "help") return { command: "help" };
  if (trimmed === "status") return { command: "status" };
  if (trimmed === "clear") return { command: "clear" };

  const management = trimmed.match(/^(pause|resume|cancel|run)\s+(\S+)$/i);
  if (management) {
    return { command: management[1].toLowerCase() as "pause" | "resume" | "cancel" | "run", id: management[2] };
  }
  if (/^(?:status|clear|help|pause|resume|cancel|run)\b/i.test(trimmed)) {
    return { command: "error", message: "Usage: /loop status | pause <id> | resume <id> | run <id> | cancel <id> | clear" };
  }

  const interval = trimmed.match(/^(\d+(?:\.\d+)?)(s|m|h|d)\s*(.*)$/i);
  if (!interval) return { command: "goal_migration", objective: trimmed };
  const intervalMs = durationMs(Number(interval[1]), interval[2].toLowerCase());
  if (intervalMs < MIN_INTERVAL_MS) return { command: "error", message: "The minimum loop interval is 1 minute." };
  if (intervalMs > MAX_INTERVAL_MS) return { command: "error", message: "The maximum loop interval is 6 days." };
  const prompt = interval[3].trim();
  if (!prompt) return { command: "error", message: "A scheduled prompt is required after the interval." };
  return { command: "create", intervalMs, prompt };
}

export function formatInterval(intervalMs: number): string {
  if (intervalMs % 86_400_000 === 0) return `${intervalMs / 86_400_000}d`;
  if (intervalMs % 3_600_000 === 0) return `${intervalMs / 3_600_000}h`;
  return `${intervalMs / 60_000}m`;
}

function durationMs(value: number, unit: string): number {
  if (unit === "d") return value * 86_400_000;
  if (unit === "h") return value * 3_600_000;
  if (unit === "m") return value * 60_000;
  return value * 1_000;
}
