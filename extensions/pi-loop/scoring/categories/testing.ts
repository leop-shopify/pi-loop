import { buildCategory } from "../category.ts";
import { boolScore, nonEmpty } from "../evidence.ts";
import type { CategoryScore, LoopScoreInput } from "../types.ts";

export function scoreTesting(input: LoopScoreInput): CategoryScore {
  const tests = input.tests;
  const evidence: string[] = [];
  const gaps: string[] = [];
  let score = 0;

  if (!tests) return buildCategory("testing", 0, evidence, ["No test evidence was provided."]);

  const behaviorAssertions = tests.observableAssertions ?? tests.assertionsExerciseBehavior;
  const changedCodeCovered = tests.changedCodeCovered ?? tests.wouldFailOnBug;
  const integrationCovered = tests.integrationOrSystemCovered ?? tests.integrationOrContractCovered;

  if ((tests.files ?? []).length > 0) {
    score += 2;
    evidence.push(`${tests.files!.length} test file(s) listed.`);
  } else {
    gaps.push("No test files were listed.");
  }

  if ((tests.behaviorsCovered ?? []).length > 0) {
    score += 2;
    evidence.push(`${tests.behaviorsCovered!.length} behavior(s) covered.`);
  } else {
    gaps.push("No behavior-level test coverage was described.");
  }

  score += boolScore(behaviorAssertions, 4);
  if (behaviorAssertions !== true) gaps.push("Externally visible behavior assertions were not proven.");

  score += boolScore(changedCodeCovered, 4);
  if (changedCodeCovered !== true) gaps.push("Changed code or target bug coverage was not proven.");

  score += boolScore(tests.regressionCovered, 2);
  if (tests.regressionCovered !== true) gaps.push("Regression coverage was not proven.");

  if ((tests.edgeCasesCovered ?? []).length > 0) score += 2;
  else gaps.push("Edge or boundary cases were not proven.");

  if ((tests.failurePathsCovered ?? []).length > 0) score += 1;
  else gaps.push("Failure path coverage was not proven.");

  if (tests.usesMocksForOwnedCode === false && tests.mockOnly === false) {
    score += 2;
    evidence.push("Owned-code mocking status was explicitly clean.");
  } else {
    gaps.push("Owned-code mock status was not explicitly clean.");
  }

  if (tests.hasSleeps === false && tests.flaky !== true && tests.implementationCoupled !== true) score += 1;
  else gaps.push("Tests are flaky, sleep-based, or coupled to implementation details.");

  if (integrationCovered === true) evidence.push("Integration or contract coverage was provided.");
  if (tests.usesFakesForExternalDeps === true || tests.externalMocksHaveContractTests === true) evidence.push("External dependency boundaries are covered by fakes, wrappers, or contract tests.");
  if (nonEmpty(tests.coverageEvidence)) evidence.push(`Coverage evidence: ${tests.coverageEvidence}`);
  if (nonEmpty(tests.mockingEvidence)) evidence.push(tests.mockingEvidence!);

  return buildCategory("testing", score, evidence, gaps);
}
