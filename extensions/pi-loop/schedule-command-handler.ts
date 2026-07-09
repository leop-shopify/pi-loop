import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatInterval, parseScheduleCommand } from "./schedule-command.ts";
import type { Scheduler } from "./scheduler.ts";

export function registerScheduleCommand(pi: ExtensionAPI, scheduler: Scheduler): void {
  const command = {
    description: "Schedule, inspect, pause, resume, run, or cancel recurring session tasks",
    getArgumentCompletions: (prefix: string) => {
      const values = ["status", "pause", "resume", "cancel", "run", "clear", "help"];
      const matches = values.filter((value) => value.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseScheduleCommand(args ?? "");
      if (parsed.command === "help") {
        ctx.ui.notify(helpText(), "info");
        return;
      }
      if (parsed.command === "error") {
        ctx.ui.notify(parsed.message, "warning");
        return;
      }
      if (parsed.command === "goal_migration") {
        ctx.ui.notify(`pi-loop now runs scheduled tasks. This input has no interval and looks like a goal. Use:\n\n/goal ${parsed.objective}`, "warning");
        return;
      }
      if (parsed.command === "status") {
        ctx.ui.notify(statusText(scheduler), "info");
        return;
      }
      if (parsed.command === "clear") {
        scheduler.clear(ctx);
        ctx.ui.notify("All scheduled loop tasks cleared.", "info");
        return;
      }
      if (parsed.command === "create") {
        try {
          const task = scheduler.add(ctx, parsed.prompt, parsed.intervalMs);
          ctx.ui.notify(`Scheduled ${task.id} every ${formatInterval(task.intervalMs)}. First run: ${new Date(task.nextRunAt).toLocaleString()}`, "info");
        } catch (error) {
          ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
        }
        return;
      }
      if (parsed.command === "cancel") {
        ctx.ui.notify(scheduler.cancel(ctx, parsed.id) ? `Cancelled ${parsed.id}.` : `No scheduled task ${parsed.id}.`, "info");
        return;
      }
      if (parsed.command === "run") {
        ctx.ui.notify(scheduler.runNow(ctx, parsed.id) ? `Queued ${parsed.id} to run now.` : `Task ${parsed.id} cannot run now.`, "info");
        return;
      }
      const status = parsed.command === "pause" ? "paused" : "active";
      const task = scheduler.setStatus(ctx, parsed.id, status);
      ctx.ui.notify(task ? `${parsed.command === "pause" ? "Paused" : "Resumed"} ${task.id}.` : `No scheduled task ${parsed.id}.`, task ? "info" : "warning");
    },
  };

  pi.registerCommand("loop", command);
  pi.registerCommand("pi-loop", command);
}

function statusText(scheduler: Scheduler): string {
  const tasks = scheduler.getState().tasks;
  if (tasks.length === 0) return "No scheduled loop tasks.";
  return tasks.map((task) => [
    `${task.id} [${task.status}${task.running ? ", running" : task.pending ? ", pending" : ""}] every ${formatInterval(task.intervalMs)}`,
    `  Next: ${new Date(task.nextRunAt).toLocaleString()}`,
    `  Runs: ${task.history.length}`,
    `  Prompt: ${task.prompt}`,
  ].join("\n")).join("\n\n");
}

function helpText(): string {
  return [
    "Usage: /loop <interval> <prompt>",
    "Example: /loop 5m check whether CI passed",
    "Commands: /loop status | pause <id> | resume <id> | run <id> | cancel <id> | clear",
    "Intervals: m, h, or d; minimum 1 minute, maximum 6 days.",
    "Scheduled tasks are scoped to this Pi session and expire after 7 days.",
    "For continuous work toward a completion condition, use /goal instead.",
  ].join("\n");
}
