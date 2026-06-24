import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { MAX_TOTAL_TURNS } from "./constants.ts";
import { loopHelp, parseLoopArgs, statusText } from "./commands.ts";
import { totalTurnBudgetExceeded } from "./run-manager.ts";
import { buildTargetContextSnapshot } from "./target-context.ts";
import type { LoopController } from "./controller.ts";
import { deleteLog, appendLogEntry } from "./log.ts";
import { kickoffPrompt } from "./prompt.ts";
import { startLoopState, stopLoop } from "./state.ts";
import { clearLoopWidget, updateLoopWidget } from "./ui.ts";

export function registerLoopCommand(pi: ExtensionAPI, controller: LoopController): void {
  pi.registerCommand("loop", {
    description: "Run a score-guided software engineering loop. Defaults: 1 hour, 20 turns.",
    handler: async (args, ctx) => {
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
      ctx.ui.notify(`pi-loop started: ${parsed.minutes} minutes, ${parsed.turns} turns per run, ${parsed.runs} run(s); first score_loop_result call records the baseline`, "info");
      controller.sendWhenReady(kickoffPrompt(state), ctx);
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
  state.stopReason = "cleared by user";
}
