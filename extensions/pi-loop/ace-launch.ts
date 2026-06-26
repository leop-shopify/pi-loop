import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { appendLogEntry } from "./log.ts";
import type { LoopAceRunState, LoopRuntimeState } from "./state.ts";
import { sendLoopStepMessage } from "./step-message.ts";
import { updateLoopWidget } from "./ui.ts";

const DEFAULT_ACE_RUN_MODE: LoopAceRunState["mode"] = "offline";
const ACE_DAEMON_EVENT = "pi-ace-adapter:launch-daemon";
const ACE_DAEMON_RESPONSE_TIMEOUT_MS = 1_000;

type NotifyLevel = "info" | "warning" | "error";

interface AceLaunchSkipped {
  status: "skipped";
  reason: string;
  storageRoot?: string;
  storageScope?: string;
  selectedPlaybook?: string;
  mode: LoopAceRunState["mode"];
}

interface AceLaunchStarted {
  status: "launched";
  storageRoot: string;
  storageScope: string;
  selectedPlaybook: string;
  mode: LoopAceRunState["mode"];
  pid: number;
  outputDir: string;
  metadataPath: string;
  stdoutPath: string;
  stderrPath: string;
}

type AceDaemonLaunchResult = AceLaunchSkipped | AceLaunchStarted;

interface AceDaemonLaunchRequest {
  ctx: ExtensionCommandContext;
  mode: LoopAceRunState["mode"];
  projectTrusted: boolean;
  onResult: (result: AceDaemonLaunchResult) => void;
  onError: (message: string) => void;
}

interface EventBusLike {
  emit(channel: string, data: unknown): void;
}

export function launchAceForLoop(pi: ExtensionAPI, ctx: ExtensionCommandContext, state: LoopRuntimeState, aceContext: string | undefined): void {
  if (state.aceRun?.status === "running") return;
  if (!aceContext?.trim()) return;
  const startedAt = Date.now();
  state.aceRun = {
    status: "running",
    mode: DEFAULT_ACE_RUN_MODE,
    startedAt,
    message: "ACE daemon launch requested",
  };
  updateLoopWidget(ctx, state);
  sendLoopStepMessage(pi, state, "launching ACE", `mode ${DEFAULT_ACE_RUN_MODE}`);
  launchAceDaemon(pi, ctx, state, startedAt);
}

function launchAceDaemon(pi: ExtensionAPI, ctx: ExtensionCommandContext, state: LoopRuntimeState, startedAt: number): void {
  const bus = eventBus(pi);
  if (!bus) {
    recordAceState(pi, ctx, state, {
      status: "failed",
      mode: DEFAULT_ACE_RUN_MODE,
      startedAt,
      completedAt: Date.now(),
      message: "ACE daemon launch failed: pi-ace-adapter event bus is not available",
    });
    return;
  }

  let settled = false;
  const settle = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    callback();
  };

  const timeout = setTimeout(() => {
    settle(() => recordAceState(pi, ctx, state, {
      status: "failed",
      mode: DEFAULT_ACE_RUN_MODE,
      startedAt,
      completedAt: Date.now(),
      message: "ACE daemon launch failed: pi-ace-adapter did not respond to the launch request",
    }));
  }, ACE_DAEMON_RESPONSE_TIMEOUT_MS);

  const request: AceDaemonLaunchRequest = {
    ctx,
    mode: DEFAULT_ACE_RUN_MODE,
    projectTrusted: isProjectTrusted(ctx),
    onResult: (result) => {
      settle(() => {
        clearTimeout(timeout);
        recordLaunchResult(pi, ctx, state, startedAt, result);
      });
    },
    onError: (message) => {
      settle(() => {
        clearTimeout(timeout);
        recordAceState(pi, ctx, state, {
          status: "failed",
          mode: DEFAULT_ACE_RUN_MODE,
          startedAt,
          completedAt: Date.now(),
          message: `ACE daemon launch failed: ${message}`,
        });
      });
    },
  };

  try {
    bus.emit(ACE_DAEMON_EVENT, request);
  } catch (error) {
    settle(() => {
      clearTimeout(timeout);
      recordAceState(pi, ctx, state, {
        status: "failed",
        mode: DEFAULT_ACE_RUN_MODE,
        startedAt,
        completedAt: Date.now(),
        message: `ACE daemon launch failed: ${errorMessage(error)}`,
      });
    });
  }
}

function recordLaunchResult(pi: ExtensionAPI, ctx: ExtensionCommandContext, state: LoopRuntimeState, startedAt: number, result: AceDaemonLaunchResult): void {
  if (result.status === "skipped") {
    recordAceState(pi, ctx, state, {
      status: "skipped",
      mode: result.mode,
      startedAt,
      completedAt: Date.now(),
      message: result.reason,
    }, { storageRoot: result.storageRoot, storageScope: result.storageScope, selectedPlaybook: result.selectedPlaybook });
    return;
  }

  recordAceState(pi, ctx, state, {
    status: "running",
    mode: result.mode,
    startedAt,
    message: `ACE daemon-ish run launched with pid ${result.pid}`,
    pid: result.pid,
    outputDir: result.outputDir,
    metadataPath: result.metadataPath,
    stdoutPath: result.stdoutPath,
    stderrPath: result.stderrPath,
  }, { storageRoot: result.storageRoot, storageScope: result.storageScope, selectedPlaybook: result.selectedPlaybook });
}

function recordAceState(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: LoopRuntimeState,
  aceRun: LoopAceRunState,
  details: Record<string, unknown> = {},
): void {
  state.aceRun = aceRun;
  appendLogEntry(ctx.cwd, {
    type: "event",
    schemaVersion: 2,
    event: eventForStatus(aceRun.status),
    timestamp: aceRun.completedAt ?? aceRun.startedAt,
    run: state.currentRun,
    turn: state.turnsStarted,
    globalTurn: state.totalTurnsStarted,
    reason: aceRun.message,
    details: compactDetails({ ...details, ...detailsForAceRun(aceRun) }),
  });
  updateLoopWidget(ctx, state);

  const message = formatAceRunMessage(aceRun);
  sendLoopStepMessage(pi, state, stepForStatus(aceRun.status), message);
  notify(ctx, message, notifyLevelForStatus(aceRun.status));
}

function eventForStatus(status: LoopAceRunState["status"]): "ace_run_started" | "ace_run_completed" | "ace_run_failed" | "ace_run_skipped" {
  if (status === "running") return "ace_run_started";
  if (status === "completed") return "ace_run_completed";
  if (status === "failed") return "ace_run_failed";
  return "ace_run_skipped";
}

function stepForStatus(status: LoopAceRunState["status"]): string {
  if (status === "running") return "ACE launched";
  if (status === "completed") return "ACE completed";
  if (status === "failed") return "ACE failed";
  return "ACE skipped";
}

function notifyLevelForStatus(status: LoopAceRunState["status"]): NotifyLevel {
  if (status === "failed") return "error";
  if (status === "skipped") return "warning";
  return "info";
}

function formatAceRunMessage(aceRun: LoopAceRunState): string {
  const output = aceRun.outputDir ? ` output: ${aceRun.outputDir}` : "";
  const metadata = aceRun.metadataPath ? ` metadata: ${aceRun.metadataPath}` : "";
  return `${aceRun.message ?? aceRun.status}.${output}${metadata}`;
}

function detailsForAceRun(aceRun: LoopAceRunState): Record<string, unknown> {
  return {
    status: aceRun.status,
    mode: aceRun.mode,
    startedAt: aceRun.startedAt,
    completedAt: aceRun.completedAt,
    pid: aceRun.pid,
    outputDir: aceRun.outputDir,
    metadataPath: aceRun.metadataPath,
    stdoutPath: aceRun.stdoutPath,
    stderrPath: aceRun.stderrPath,
    candidatePath: aceRun.candidatePath,
    sampleCount: aceRun.sampleCount,
    validationScore: aceRun.validationScore,
    code: aceRun.code,
  };
}

function compactDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}

function eventBus(pi: ExtensionAPI): EventBusLike | undefined {
  const candidate = (pi as ExtensionAPI & { events?: Partial<EventBusLike> }).events;
  return typeof candidate?.emit === "function" ? candidate as EventBusLike : undefined;
}

function isProjectTrusted(ctx: ExtensionCommandContext): boolean {
  try {
    const candidate = ctx as ExtensionCommandContext & { isProjectTrusted?: () => boolean };
    return typeof candidate.isProjectTrusted === "function" ? candidate.isProjectTrusted() : false;
  } catch {
    return false;
  }
}

function notify(ctx: ExtensionCommandContext, message: string, level: NotifyLevel): void {
  try {
    ctx.ui.notify(message, level);
  } catch {
    // Notifications are visibility-only and must not block the loop.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
