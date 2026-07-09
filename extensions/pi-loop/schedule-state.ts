import { randomBytes } from "node:crypto";

export type ScheduledTaskStatus = "active" | "paused";
export type ScheduledRunOutcome = "completed" | "failed" | "cancelled";

export type ScheduledRun = {
  scheduledAt: number;
  startedAt: number;
  finishedAt: number | null;
  outcome: ScheduledRunOutcome | null;
};

export type ScheduledTask = {
  id: string;
  prompt: string;
  intervalMs: number;
  status: ScheduledTaskStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  nextRunAt: number;
  lastRunAt: number | null;
  running: boolean;
  pending: boolean;
  currentRun: ScheduledRun | null;
  history: ScheduledRun[];
};

export type ScheduleState = {
  version: 1;
  tasks: ScheduledTask[];
};

const TASK_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_HISTORY = 20;

export function createScheduleState(): ScheduleState {
  return { version: 1, tasks: [] };
}

export function createScheduledTask(
  prompt: string,
  intervalMs: number,
  now = Date.now(),
  idFactory = () => randomBytes(4).toString("hex"),
): ScheduledTask {
  return {
    id: idFactory(),
    prompt: prompt.trim(),
    intervalMs,
    status: "active",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + TASK_TTL_MS,
    nextRunAt: now + intervalMs,
    lastRunAt: null,
    running: false,
    pending: false,
    currentRun: null,
    history: [],
  };
}

export function dueTask(task: ScheduledTask, now = Date.now()): boolean {
  return task.status === "active"
    && !task.running
    && now < task.expiresAt
    && (task.pending || task.nextRunAt <= now);
}

export function startScheduledRun(task: ScheduledTask, now = Date.now()): ScheduledTask {
  return {
    ...task,
    running: true,
    pending: false,
    currentRun: {
      scheduledAt: task.nextRunAt,
      startedAt: now,
      finishedAt: null,
      outcome: null,
    },
    updatedAt: now,
  };
}

export function completeScheduledRun(
  task: ScheduledTask,
  now = Date.now(),
  outcome: ScheduledRunOutcome = "completed",
): ScheduledTask {
  const run = task.currentRun ?? {
    scheduledAt: task.nextRunAt,
    startedAt: now,
    finishedAt: null,
    outcome: null,
  };
  return {
    ...task,
    running: false,
    pending: false,
    currentRun: null,
    lastRunAt: now,
    nextRunAt: nextFutureRun(task.nextRunAt, task.intervalMs, now),
    history: [...task.history, { ...run, finishedAt: now, outcome }].slice(-MAX_HISTORY),
    updatedAt: now,
  };
}

export function restoreScheduleState(input: unknown, now = Date.now()): ScheduleState {
  if (!input || typeof input !== "object") return createScheduleState();
  const tasks = Array.isArray((input as ScheduleState).tasks) ? (input as ScheduleState).tasks : [];
  return {
    version: 1,
    tasks: tasks
      .filter((task) => task && typeof task.id === "string" && task.expiresAt > now)
      .map((task) => {
        const history = Array.isArray(task.history) ? task.history : [];
        const interrupted = task.running && task.currentRun
          ? [{ ...task.currentRun, finishedAt: now, outcome: "cancelled" as const }]
          : [];
        return {
          ...task,
          running: false,
          pending: task.running || task.pending,
          currentRun: null,
          history: [...history, ...interrupted].slice(-MAX_HISTORY),
        };
      }),
  };
}

export function updateTask(state: ScheduleState, task: ScheduledTask): ScheduleState {
  return { ...state, tasks: state.tasks.map((candidate) => candidate.id === task.id ? task : candidate) };
}

export function removeTask(state: ScheduleState, id: string): ScheduleState {
  return { ...state, tasks: state.tasks.filter((task) => task.id !== id) };
}

function nextFutureRun(previous: number, intervalMs: number, now: number): number {
  const missed = Math.max(1, Math.floor((now - previous) / intervalMs) + 1);
  return previous + missed * intervalMs;
}
