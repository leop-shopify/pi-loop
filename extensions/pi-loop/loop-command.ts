import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { buildAceLoopContext } from "./ace-context.ts";
import { launchAceForLoop } from "./ace-launch.ts";
import { MAX_TOTAL_TURNS } from "./constants.ts";
import { goalHelp, parseLoopArgs, statusText } from "./commands.ts";
import { totalTurnBudgetExceeded } from "./run-manager.ts";
import { buildTargetContextSnapshot } from "./target-context.ts";
import type { LoopController } from "./controller.ts";
import { deleteLog, appendLogEntry } from "./log.ts";
import { kickoffPrompt } from "./prompt.ts";
import { startLoopState, stopLoop } from "./state.ts";
import { sendLoopStepMessage } from "./step-message.ts";
import { clearLoopWidget, setLoopWidgetVisible, toggleLoopWidget, updateLoopWidget } from "./ui.ts";

export interface GoalCommandOptions {
  autonomyBusy?: () => boolean;
}

export interface GoalStartResult {
  started: boolean;
  reason: string;
}

export interface GoalCommandRuntime {
  start(ctx: ExtensionContext, args: string): Promise<GoalStartResult>;
}

export function registerGoalCommand(pi: ExtensionAPI, controller: LoopController, options: GoalCommandOptions = {}): GoalCommandRuntime {
  const autonomyBusy = options.autonomyBusy ?? (() => false);

  const start = async (ctx: ExtensionContext, args: string): Promise<GoalStartResult> => {
    const parsed = parseLoopArgs(args ?? "");
    if (parsed.command !== "start") {
      const reason = "Goal start requires an objective; management words such as status, stop, off, clear, hide, show, and toggle are reserved.";
      ctx.ui.notify(parsed.command === "help" ? goalHelp() : reason, parsed.command === "help" ? "info" : "warning");
      return { started: false, reason };
    }

    const state = controller.getState(ctx);
    if (state.active) {
      const reason = "pi-goal is already active. Use /goal off first if you want to restart.";
      ctx.ui.notify(reason, "warning");
      return { started: false, reason };
    }
    if (autonomyBusy()) {
      const reason = "Another autonomous mode is active. Wait for it to finish before starting a Goal.";
      ctx.ui.notify(reason, "warning");
      return { started: false, reason };
    }
    if (totalTurnBudgetExceeded(parsed.runs, parsed.turns)) {
      const reason = `pi-goal run budget is too large: runs * turns must be <= ${MAX_TOTAL_TURNS}`;
      ctx.ui.notify(reason, "warning");
      return { started: false, reason };
    }

    const targetContext = buildTargetContextSnapshot({ cwd: ctx.cwd, goal: parsed.goal, files: parsed.files, symbols: parsed.symbols, checks: parsed.checks, priorScores: state.results });
    const config = startLoopState(state, {
      goal: parsed.goal,
      targetScore: parsed.target,
      maxTurns: parsed.turns,
      maxMinutes: parsed.minutes,
      maxRuns: parsed.runs,
      targetContext,
      sessionId: controller.sessionKey(ctx),
    });
    appendLogEntry(ctx.cwd, config);
    controller.setScoreToolActive(true);
    updateLoopWidget(ctx, state);
    sendLoopStepMessage(pi, state, "starting loop", `run ${state.currentRun}/${state.maxRuns}, ${state.maxTurns} attempts max`, ctx.cwd);
    ctx.ui.notify(`pi-goal started: ${parsed.minutes} minutes, ${parsed.turns} turns per run, ${parsed.runs} run(s); first loop_feedback call records the baseline`, "info");
    const aceContext = await buildAceLoopContext(ctx);
    launchAceForLoop(pi, ctx as ExtensionCommandContext, state, aceContext);
    sendLoopStepMessage(pi, state, "kickoff prompt", "sent initial loop instructions", ctx.cwd);
    controller.sendWhenReady(kickoffPrompt(state, { aceContext }), ctx);
    return { started: true, reason: "started" };
  };

  const command = {
    description: "Run or control a score-guided Goal. Defaults: 10 minutes, 12 turns.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseLoopArgs(args ?? "");
      const state = controller.getState(ctx);

      if (parsed.command === "help") {
        ctx.ui.notify(goalHelp(), "info");
        return;
      }
      if (parsed.command === "status") {
        ctx.ui.notify(statusText(state, ctx.cwd), "info");
        updateLoopWidget(ctx, state);
        return;
      }
      if (parsed.command === "off") {
        if (!state.active) {
          ctx.ui.notify("No intelligent Goal is active.", "info");
          return;
        }
        controller.finishLoop(ctx, state, "stopped by user");
        ctx.ui.notify("pi-goal stopped", "info");
        return;
      }
      if (parsed.command === "clear") {
        clearLoop(state);
        controller.setScoreToolActive(false);
        clearLoopWidget(ctx);
        ctx.ui.notify(deleteLog(ctx.cwd) ? "pi-goal log deleted" : "No pi-goal log found", "info");
        return;
      }
      if (parsed.command === "hide") {
        setLoopWidgetVisible(ctx, state, false);
        ctx.ui.notify("pi-goal panel hidden. Use /pi-goal show or Ctrl+Alt+L to restore it.", "info");
        return;
      }
      if (parsed.command === "show") {
        setLoopWidgetVisible(ctx, state, true);
        ctx.ui.notify("pi-goal panel shown.", "info");
        return;
      }
      if (parsed.command === "toggle") {
        const visible = toggleLoopWidget(ctx, state);
        ctx.ui.notify(`pi-goal panel ${visible ? "shown" : "hidden"}.`, "info");
        return;
      }

      await start(ctx, args);
    },
  };

  pi.registerCommand("goal", command);
  pi.registerCommand("pi-goal", command);
  pi.registerShortcut(Key.ctrlAlt("l"), {
    description: "Toggle pi-goal floating panel",
    handler: async (ctx) => {
      const state = controller.getState(ctx);
      const visible = toggleLoopWidget(ctx, state);
      ctx.ui.notify(`pi-goal panel ${visible ? "shown" : "hidden"}.`, "info");
    },
  });

  return { start };
}

function clearLoop(state: Parameters<typeof stopLoop>[0]): void {
  stopLoop(state, "cleared by user");
  state.results = [];
  state.goal = null;
  state.turnsStarted = 0;
  state.totalTurnsStarted = 0;
  state.pausedMs = 0;
  state.timerPausedAt = null;
  state.runs = [];
  state.sessionId = null;
  state.targetContext = null;
  state.currentPrompt = null;
  state.currentTurnStartedAt = null;
  state.lastTurnDurationMs = null;
  state.turnDurations = [];
  state.pendingFeedbackTurn = null;
  state.contextUsage = null;
  state.stepHistory = [];
  state.aceRun = null;
  state.stopReason = "cleared by user";
}
