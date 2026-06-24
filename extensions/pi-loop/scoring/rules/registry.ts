import type { LoopScoreInput, Cap } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export class RuleRegistry {
  private readonly loadedRules: ScoringRule[] = [];

  constructor(rules: readonly ScoringRule[] = []) {
    for (const rule of rules) this.load(rule);
  }

  load(rule: ScoringRule): this {
    this.loadedRules.push(rule);
    return this;
  }

  evaluate(input: LoopScoreInput): Cap[] {
    return this.loadedRules.flatMap((rule) => rule.evaluate(input));
  }

  rules(): ScoringRule[] {
    return [...this.loadedRules];
  }
}
