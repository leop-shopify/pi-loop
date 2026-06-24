import { hasProductionArtifacts } from "../evidence.ts";
import type { Cap, LoopScoreInput } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const testQualityRule: ScoringRule = {
  name: "test-quality",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    const productionArtifacts = hasProductionArtifacts(input);
    const behaviorAssertions = input.tests?.observableAssertions ?? input.tests?.assertionsExerciseBehavior;
    const changedCodeCovered = input.tests?.changedCodeCovered ?? input.tests?.wouldFailOnBug;

    if (productionArtifacts && ((input.tests?.files ?? []).length === 0)) caps.push({ value: 70, reason: "Executable behavior changed without meaningful tests listed." });
    if (productionArtifacts && input.tests && changedCodeCovered !== true) caps.push({ value: 70, reason: "Executable behavior changed without changed-code or target-bug coverage evidence." });
    if (input.tests?.mockOnly) caps.push({ value: 50, reason: "Tests are mock-only." });
    if (input.tests?.usesMocksForOwnedCode) caps.push({ value: 75, reason: "Tests mock or stub owned code." });
    if (input.tests && (input.tests.usesMocksForOwnedCode !== false || input.tests.mockOnly !== false)) caps.push({ value: 85, reason: "Mocking status was not explicitly clean." });
    if (input.tests && behaviorAssertions !== true) caps.push({ value: 70, reason: "Tests do not prove observable behavior assertions." });
    if (input.tests?.implementationCoupled) caps.push({ value: 75, reason: "Tests are coupled to implementation details or change-detector assertions." });
    if (input.tests?.externalMocksHaveContractTests === false) caps.push({ value: 80, reason: "External dependency mocks lack contract, wrapper, or fake evidence." });
    if (input.tests?.flaky || input.tests?.hasSleeps) caps.push({ value: 80, reason: "Tests are flaky or use timing sleeps." });

    return caps;
  },
};
