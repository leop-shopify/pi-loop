import { attemptRule } from "./attempt.ts";
import { contradictionsRule } from "./contradictions.ts";
import { designSolidRule } from "./design-solid.ts";
import { operabilityRule } from "./operability.ts";
import { railsSafetyRule } from "./rails-safety.ts";
import { requirementsRule } from "./requirements.ts";
import { reviewGatesRule } from "./review-gates.ts";
import { risksRule } from "./risks.ts";
import { RuleRegistry } from "./registry.ts";
import { testQualityRule } from "./test-quality.ts";
import { verificationRule } from "./verification.ts";
import type { ScoringRule } from "./types.ts";

export { RuleRegistry } from "./registry.ts";
export type { ScoringRule } from "./types.ts";
export { attemptRule } from "./attempt.ts";
export { contradictionsRule } from "./contradictions.ts";
export { designSolidRule } from "./design-solid.ts";
export { operabilityRule } from "./operability.ts";
export { railsSafetyRule } from "./rails-safety.ts";
export { requirementsRule } from "./requirements.ts";
export { reviewGatesRule } from "./review-gates.ts";
export { risksRule } from "./risks.ts";
export { testQualityRule } from "./test-quality.ts";
export { verificationRule } from "./verification.ts";

export const builtInRules: readonly ScoringRule[] = [
  requirementsRule,
  attemptRule,
  verificationRule,
  testQualityRule,
  reviewGatesRule,
  railsSafetyRule,
  designSolidRule,
  operabilityRule,
  risksRule,
  contradictionsRule,
];

export function createDefaultRuleRegistry(): RuleRegistry {
  const registry = new RuleRegistry();
  for (const rule of builtInRules) registry.load(rule);
  return registry;
}

export const defaultRuleRegistry = createDefaultRuleRegistry();
