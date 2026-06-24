import { buildCategory } from "../category.ts";
import { boolScore, nonEmpty } from "../evidence.ts";
import type { CategoryScore, LoopScoreInput } from "../types.ts";

export function scoreDesign(input: LoopScoreInput): CategoryScore {
  const design = input.design;
  const evidence: string[] = [];
  const gaps: string[] = [];
  let score = 0;

  if (!design) return buildCategory("design", 0, evidence, ["No design evidence was provided."]);

  const singleResponsibility = design.singleResponsibility ?? design.responsibilitiesSplit;
  const lowCoupling = design.lowCouplingHighCohesion ?? design.lowCoupling ?? design.dependenciesSimple;
  const dependencyDirection = design.dependencyDirectionClear ?? design.boundariesClear;
  const complexityControlled = design.complexityControlled ?? design.complexityManaged ?? design.smallFiles;
  const encapsulation = design.encapsulation ?? design.minimalPublicSurface ?? design.solid;

  score += boolScore(singleResponsibility, 4);
  score += boolScore(design.boundariesClear, 2);
  score += boolScore(lowCoupling, 3);
  score += boolScore(dependencyDirection, 2);
  score += boolScore(encapsulation, 2);
  score += boolScore(complexityControlled, 2);
  score += boolScore(design.duplicationAvoided, 1);
  score += boolScore(design.noGodFiles, 2);

  if (singleResponsibility) evidence.push("Single responsibility and cohesion are shown.");
  else gaps.push("Single responsibility or cohesion evidence is missing.");
  if (design.boundariesClear) evidence.push("Boundaries are clear.");
  else gaps.push("Boundary clarity was not shown.");
  if (lowCoupling) evidence.push("Coupling and dependencies are controlled.");
  else gaps.push("Low-coupling evidence is missing.");
  if (dependencyDirection) evidence.push("Dependency direction is clear.");
  else gaps.push("Dependency direction evidence is missing.");
  if (encapsulation) evidence.push("Encapsulation or minimal public surface was considered.");
  else gaps.push("Encapsulation or public-surface evidence is missing.");
  if (complexityControlled) evidence.push("Complexity is controlled.");
  else gaps.push("Complexity-control evidence is missing.");
  if (design.duplicationAvoided) evidence.push("Duplication was avoided.");
  if (design.noGodFiles) evidence.push("No god file or object was introduced.");
  else gaps.push("No-god-file evidence is missing.");
  if (nonEmpty(design.evidence)) evidence.push(design.evidence!);

  return buildCategory("design", score, evidence, gaps);
}
