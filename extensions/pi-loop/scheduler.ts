import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  completeScheduledRun,
  createScheduleState,
  createScheduledTask,
  dueTask,
  removeTask,
  restoreScheduleState,
  startScheduledRun,
  updateTask,
  type ScheduleState,
  type ScheduledTask,
  type ScheduledTaskStatus,
} from "./schedule-state.ts";

const STATE_TYPE = "pi-loop-schedule";
const MAX_TASKS = 50;
const DEFER_MS = 60_000;

type Timer = ReturnType<typeof setTimeout>;

type SchedulerOptions = {
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  idFactory?: () => string;
  autonomyBusy?: () => boolean;
};

export type Scheduler = {
  getState(): ScheduleState;
  add(ctx: ExtensionContext, prompt: string, intervalMs: number): ScheduledTask;
  setStatus(ctx: ExtensionContext, id: string, status: ScheduledTaskStatus): ScheduledTask | null;
  cancel(ctx: ExtensionContext, id: string): boolean;
  clear(ctx: ExtensionContext): void;
  runNow(ctx: ExtensionContext, id: string): boolean;
  restore(ctx: ExtensionContext, input: unknown): void;
  tick(ctx: ExtensionContext): Promise<void>;
  onAgentEnd(ctx: ExtensionContext, outcome?: "completed" | "failed" | "cancelled"): void;
  shutdown(): void;
};

export function createScheduler(pi: ExtensionAPI, options: SchedulerOptions = {}): Scheduler {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = options.clearTimer ?? clearTimeout;
  const autonomyBusy = options.autonomyBusy ?? (() => false);
  let state = createScheduleState();
  let timer: Timer | null = null;
  let dispatchingTaskId: string | null = null;

  function pruneExpired(): void {
    const current = now();
    state = { ...state, tasks: state.tasks.filter((task) => task.running || task.expiresAt > current) };
    if (dispatchingTaskId && !state.tasks.some((task) => task.id === dispatchingTaskId)) dispatchingTaskId = null;
  }

  function persist(ctx: ExtensionContext): void {
    pi.appendEntry(STATE_TYPE, state);
    arm(ctx);
  }

  function arm(ctx: ExtensionContext): void {
    if (timer) clearTimer(timer);
    timer = null;
    const current = now();
    const next = state.tasks
      .filter((task) => task.status === "active" && !task.running && task.expiresAt > current)
      .map((task) => task.pending ? current + DEFER_MS : task.nextRunAt)
      .sort((left, right) => left - right)[0];
    if (next === undefined) return;
    timer = setTimer(() => {
      timer = null;
      void api.tick(ctx);
    }, Math.max(0, next - current));
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }
  }

  function taskById(id: string): ScheduledTask | null {
    return state.tasks.find((task) => task.id === id) ?? null;
  }

  const api: Scheduler = {
    getState() {
      pruneExpired();
      return state;
    },
    add(ctx, prompt, intervalMs) {
      pruneExpired();
      if (state.tasks.length >= MAX_TASKS) throw new Error(`A session can hold at most ${MAX_TASKS} scheduled tasks.`);
      const task = createScheduledTask(prompt, intervalMs, now(), options.idFactory);
      state = { ...state, tasks: [...state.tasks, task] };
      persist(ctx);
      return task;
    },
    setStatus(ctx, id, status) {
      pruneExpired();
      const task = taskById(id);
      if (!task) return null;
      const updated = { ...task, status, pending: status === "active" ? task.pending : false, updatedAt: now() };
      state = updateTask(state, updated);
      persist(ctx);
      return updated;
    },
    cancel(ctx, id) {
      pruneExpired();
      const found = Boolean(taskById(id));
      if (!found) return false;
      state = removeTask(state, id);
      if (dispatchingTaskId === id) dispatchingTaskId = null;
      persist(ctx);
      return true;
    },
    clear(ctx) {
      state = createScheduleState();
      dispatchingTaskId = null;
      persist(ctx);
    },
    runNow(ctx, id) {
      pruneExpired();
      const task = taskById(id);
      if (!task || task.status !== "active" || task.running) return false;
      state = updateTask(state, { ...task, pending: true, nextRunAt: now(), updatedAt: now() });
      persist(ctx);
      void api.tick(ctx);
      return true;
    },
    restore(ctx, input) {
      state = restoreScheduleState(input, now());
      dispatchingTaskId = null;
      arm(ctx);
    },
    async tick(ctx) {
      const current = now();
      state = { ...state, tasks: state.tasks.filter((task) => task.running || task.expiresAt > current) };
      const task = state.tasks.filter((candidate) => dueTask(candidate, current)).sort((left, right) => left.nextRunAt - right.nextRunAt)[0];
      if (!task) {
        persist(ctx);
        return;
      }
      if (dispatchingTaskId || state.tasks.some((candidate) => candidate.running)) {
        state = updateTask(state, { ...task, pending: true, updatedAt: current });
        persist(ctx);
        return;
      }
      if (!ctx.isIdle() || ctx.hasPendingMessages() || autonomyBusy()) {
        state = updateTask(state, { ...task, pending: true, updatedAt: current });
        persist(ctx);
        return;
      }
      const running = startScheduledRun(task, current);
      state = updateTask(state, running);
      dispatchingTaskId = task.id;
      persist(ctx);
      pi.sendMessage(
        {
          customType: "pi-loop-scheduled-run",
          content: scheduledPrompt(running),
          display: true,
          details: { taskId: running.id, scheduledAt: running.currentRun?.scheduledAt },
        },
        { triggerTurn: true },
      );
    },
    onAgentEnd(ctx, outcome = "completed") {
      if (!dispatchingTaskId) return;
      const task = taskById(dispatchingTaskId);
      dispatchingTaskId = null;
      if (!task) return;
      const completed = completeScheduledRun(task, now(), outcome);
      state = updateTask(state, completed);
      persist(ctx);
      pruneExpired();
    },
    shutdown() {
      if (timer) clearTimer(timer);
      timer = null;
      dispatchingTaskId = null;
    },
  };

  return api;
}

function scheduledPrompt(task: ScheduledTask): string {
  return `Run one bounded scheduled task. Do not turn it into an open-ended completion loop or create a goal unless the user explicitly asks. Report what happened and stop after this run.\n\n<scheduled_task id="${task.id}" interval_ms="${task.intervalMs}">\n${task.prompt}\n</scheduled_task>`;
}
