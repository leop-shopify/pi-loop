import { defaultRuleRegistry, type RuleRegistry } from "./rules/index.ts";
import type { Cap, LoopScoreInput } from "./types.ts";

export function buildCaps(input: LoopScoreInput, registry: RuleRegistry = defaultRuleRegistry): Cap[] {
  return registry.evaluate(input);
}
