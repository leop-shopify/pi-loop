import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { createAgentEndGate, type AgentEndGate } from "./agent-end-gate.ts";
import { FEEDBACK_TOOL_NAME } from "./constants.ts";
import { createLoopController } from "./controller.ts";
import { registerLoopEvents } from "./events.ts";
import { registerGoalCommand } from "./loop-command.ts";
import { bestProgressEntry } from "./progress.ts";
import { createRuntimeStore } from "./runtime-store.ts";
import { registerScoreTool } from "./score-tool.ts";
import type { LoopRuntimeState, LoopScoreEntry } from "./state.ts";

const GoalText = Type.String({ minLength: 1 });
const GoalTextList = Type.Array(GoalText);
const CreateGoalParams = Type.Object({
  objective: GoalText,
  outcome: Type.Optional(GoalText),
  verification: Type.Optional(GoalTextList),
  constraints: Type.Optional(GoalTextList),
  boundaries: Type.Optional(GoalTextList),
  acceptanceCriteria: Type.Optional(GoalTextList),
  iterationPolicy: Type.Optional(GoalText),
  blockedStop: Type.Optional(GoalText),
}, { additionalProperties: false });
const GetGoalParams = Type.Object({}, { additionalProperties: false });

export interface IntelligentGoalOptions {
  autonomyBusy?: () => boolean;
  agentEndGate?: AgentEndGate;
}

export interface IntelligentGoalRuntime {
  isBusy(): boolean;
  getWorkMode(): "goal" | null;
  start(ctx: ExtensionContext, objective: string): Promise<boolean>;
}

interface GoalScoreSummary {
  run: number;
  turn: number;
  globalTurn: number;
  score: number;
  targetScore: number;
  progressPercent: number | null;
  outcome: string | null;
  timestamp: number;
  summary: string;
}

interface GoalSummary {
  active: boolean;
  objective: string;
  targetScore: number;
  maxMinutes: number;
  maxTurns: number;
  maxRuns: number;
  currentRun: number;
  turnsStarted: number;
  totalTurnsStarted: number;
  startedAt: number | null;
  stopReason: string | null;
  baseline: GoalScoreSummary | null;
  latest: GoalScoreSummary | null;
  best: GoalScoreSummary | null;
  targets: {
    files: string[];
    symbols: string[];
    checks: string[];
  };
}

interface GetGoalDetails {
  goal: GoalSummary | null;
}

interface CreateGoalDetails extends GetGoalDetails {
  started: boolean;
  requestedObjective: string;
  reason: string;
}

type StructuredGoalInput = {
  objective: string;
  outcome?: string;
  verification?: string[];
  constraints?: string[];
  boundaries?: string[];
  acceptanceCriteria?: string[];
  iterationPolicy?: string;
  blockedStop?: string;
};

export function registerIntelligentGoal(pi: ExtensionAPI, options: IntelligentGoalOptions = {}): IntelligentGoalRuntime {
  const store = createRuntimeStore();
  const controller = createLoopController(pi, store, FEEDBACK_TOOL_NAME);
  const agentEndGate = options.agentEndGate ?? createAgentEndGate();

  registerScoreTool(pi, controller);
  registerLoopEvents(pi, controller, agentEndGate);
  const command = registerGoalCommand(pi, controller, { autonomyBusy: options.autonomyBusy });

  pi.registerTool({
    name: "get_goal",
    label: "Get Goal",
    description: "Read a non-circular summary of the current intelligent Goal and its score-guided progress.",
    promptSnippet: "Read the current intelligent Goal, progress, and bounded run state",
    promptGuidelines: [
      "Call get_goal only when the current Goal objective or progress is needed and is not already present in the continuation prompt.",
    ],
    parameters: GetGoalParams,
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx): Promise<AgentToolResult<GetGoalDetails>> {
      const goal = summarizeGoal(controller.getState(ctx));
      return {
        content: [{ type: "text", text: JSON.stringify({ goal }, null, 2) }],
        details: { goal },
      };
    },
  });

  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    description: "Start the intelligent score-guided Goal engine from an explicit, durable objective and reviewed completion contract.",
    promptSnippet: "Start an intelligent Goal only when the user explicitly requests Goal mode",
    promptGuidelines: [
      "Use create_goal only when the user explicitly asks to set, start, follow, change, or replace a Goal, or higher-priority instructions require Goal mode.",
      "Do not infer Goal mode from an ordinary coding task or one-off prompt.",
      "Give create_goal a self-contained objective with concrete outcome, verification, constraints, boundaries, acceptance criteria, iteration policy, and blocked stop details when those fields are known.",
      "Ask the user before calling create_goal when missing success criteria or boundaries materially change the work contract.",
    ],
    parameters: CreateGoalParams,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<CreateGoalDetails>> {
      const objective = formatStructuredObjective(params);
      const result = await command.start(ctx, objective);
      const goal = summarizeGoal(controller.getState(ctx));
      return {
        content: [{
          type: "text",
          text: result.started
            ? JSON.stringify({ started: true, goal }, null, 2)
            : `Goal was not started: ${result.reason}`,
        }],
        details: {
          started: result.started,
          requestedObjective: objective,
          reason: result.reason,
          goal,
        },
      };
    },
  });

  return {
    isBusy: () => store.hasActive(),
    getWorkMode: () => store.hasActive() ? "goal" : null,
    async start(ctx, objective) {
      const result = await command.start(ctx, objective);
      return result.started;
    },
  };
}

export default registerIntelligentGoal;

function formatStructuredObjective(input: StructuredGoalInput): string {
  const sections = [`Objective:\n${input.objective.trim()}`];
  addTextSection(sections, "Outcome", input.outcome);
  addListSection(sections, "Verification", input.verification);
  addListSection(sections, "Constraints", input.constraints);
  addListSection(sections, "Boundaries", input.boundaries);
  addListSection(sections, "Acceptance criteria", input.acceptanceCriteria);
  addTextSection(sections, "Iteration policy", input.iterationPolicy);
  addTextSection(sections, "Blocked stop", input.blockedStop);
  return sections.join("\n\n");
}

function addTextSection(sections: string[], label: string, value: string | undefined): void {
  const text = value?.trim();
  if (text) sections.push(`${label}:\n${text}`);
}

function addListSection(sections: string[], label: string, values: string[] | undefined): void {
  const items = uniqueText(values);
  if (items.length) sections.push(`${label}:\n${items.map((item) => `- ${item}`).join("\n")}`);
}

function uniqueText(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function summarizeGoal(state: LoopRuntimeState): GoalSummary | null {
  if (!state.goal) return null;
  return {
    active: state.active,
    objective: state.goal,
    targetScore: state.targetScore,
    maxMinutes: state.maxMinutes,
    maxTurns: state.maxTurns,
    maxRuns: state.maxRuns,
    currentRun: state.currentRun,
    turnsStarted: state.turnsStarted,
    totalTurnsStarted: state.totalTurnsStarted,
    startedAt: state.startedAt,
    stopReason: state.stopReason,
    baseline: summarizeScore(state.results[0]),
    latest: summarizeScore(state.results.at(-1)),
    best: summarizeScore(bestProgressEntry(state) ?? undefined),
    targets: {
      files: state.targetContext?.files.map((file) => file.path) ?? [],
      symbols: state.targetContext?.symbols.map((symbol) => symbol.name) ?? [],
      checks: state.targetContext?.checks.map((check) => check.command) ?? [],
    },
  };
}

function summarizeScore(entry: LoopScoreEntry | undefined): GoalScoreSummary | null {
  if (!entry) return null;
  return {
    run: entry.run ?? 1,
    turn: entry.turn,
    globalTurn: entry.globalTurn ?? entry.turn,
    score: entry.score,
    targetScore: entry.targetScore,
    progressPercent: entry.progressPercent ?? null,
    outcome: entry.outcome ?? null,
    timestamp: entry.timestamp,
    summary: entry.summary,
  };
}
