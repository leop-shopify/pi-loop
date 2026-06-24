import type { Cap, LoopScoreInput } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const requirementsRule: ScoringRule = {
  name: "requirements",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    const requirements = input.requirements ?? [];

    if (requirements.length === 0) caps.push({ value: 85, reason: "No explicit requirements or acceptance criteria were provided." });
    if (requirements.some((requirement) => requirement.status === "missing")) caps.push({ value: 75, reason: "At least one requirement is missing." });
    if (requirements.some((requirement) => requirement.status === "unknown" && requirement.critical)) caps.push({ value: 75, reason: "A critical requirement is unknown." });
    else if (requirements.some((requirement) => requirement.status === "unknown")) caps.push({ value: 85, reason: "At least one requirement is unknown." });
    if ((input.artifacts ?? []).length === 0) caps.push({ value: 85, reason: "No changed or inspected artifacts were listed." });

    return caps;
  },
};
