import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

import { buildAceLoopContext } from "./ace-context.ts";
import { MAX_TOTAL_TURNS } from "./constants.ts";
import { loopHelp, parseLoopArgs, statusText } from "./commands.ts";
import { totalTurnBudgetExceeded } from "./run-manager.ts";
import { buildTargetContextSnapshot } from "./target-context.ts";
import type { LoopController } from "./controller.ts";
import { deleteLog, appendLogEntry } from "./log.ts";
import { kickoffPrompt } from "./prompt.ts";
import { startLoopState, stopLoop } from "./state.ts";
import { sendLoopStepMessage } from "./step-message.ts";
import { clearLoopWidget, setLoopWidgetVisible, toggleLoopWidget, updateLoopWidget } from "./ui.ts";

export function registerLoopCommand(pi: ExtensionAPI, controller: LoopController): void {
  const command = {
    description: "Run or control a score-guided software engineering loop. Defaults: 10 minutes, 12 turns.",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parsed = parseLoopArgs(args ?? "");
      const state = controller.getState(ctx);

      if (parsed.command === "help") {
        ctx.ui.notify(loopHelp(), "info");
        return;
      }
      if (parsed.command === "status") {
        ctx.ui.notify(statusText(state, ctx.cwd), "info");
        updateLoopWidget(ctx, state);
        return;
      }
      if (parsed.command === "off") {
        controller.finishLoop(ctx, state, "stopped by user");
        ctx.ui.notify("pi-loop stopped", "info");
        return;
      }
      if (parsed.command === "clear") {
        clearLoop(state);
        controller.setScoreToolActive(false);
        clearLoopWidget(ctx);
        ctx.ui.notify(deleteLog(ctx.cwd) ? "pi-loop log deleted" : "No pi-loop log found", "info");
        return;
      }
      if (parsed.command === "hide") {
        setLoopWidgetVisible(ctx, state, false);
        ctx.ui.notify("pi-loop panel hidden. Use /pi-loop show or Ctrl+Alt+L to restore it.", "info");
        return;
      }
      if (parsed.command === "show") {
        setLoopWidgetVisible(ctx, state, true);
        ctx.ui.notify("pi-loop panel shown.", "info");
        return;
      }
      if (parsed.command === "toggle") {
        const visible = toggleLoopWidget(ctx, state);
        ctx.ui.notify(`pi-loop panel ${visible ? "shown" : "hidden"}.`, "info");
        return;
      }
      if (state.active) {
        ctx.ui.notify("pi-loop is already active. Use /loop off first if you want to restart.", "warning");
        return;
      }

      if (totalTurnBudgetExceeded(parsed.runs, parsed.turns)) {
        ctx.ui.notify(`pi-loop run budget is too large: runs * turns must be <= ${MAX_TOTAL_TURNS}`, "warning");
        return;
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
      sendLoopStepMessage(pi, state, "starting loop", `run ${state.currentRun}/${state.maxRuns}, ${state.maxTurns} attempts max`);
      ctx.ui.notify(`pi-loop started: ${parsed.minutes} minutes, ${parsed.turns} turns per run, ${parsed.runs} run(s); first score_loop_result call records the baseline`, "info");
      const aceContext = await buildAceLoopContext(ctx);
      sendLoopStepMessage(pi, state, "kickoff prompt", "sent initial loop instructions");
      controller.sendWhenReady(kickoffPrompt(state, { aceContext }), ctx);
    },
  };

  pi.registerCommand("loop", command);
  pi.registerCommand("pi-loop", command);
  pi.registerShortcut(Key.ctrlAlt("l"), {
    description: "Toggle pi-loop floating panel",
    handler: async (ctx) => {
      const state = controller.getState(ctx);
      const visible = toggleLoopWidget(ctx, state);
      ctx.ui.notify(`pi-loop panel ${visible ? "shown" : "hidden"}.`, "info");
    },
  });
}

function clearLoop(state: Parameters<typeof stopLoop>[0]): void {
  stopLoop(state, "cleared by user");
  state.results = [];
  state.goal = null;
  state.turnsStarted = 0;
  state.totalTurnsStarted = 0;
  state.runs = [];
  state.sessionId = null;
  state.targetContext = null;
  state.currentPrompt = null;
  state.currentTurnStartedAt = null;
  state.lastTurnDurationMs = null;
  state.turnDurations = [];
  state.contextUsage = null;
  state.stopReason = "cleared by user";
}
