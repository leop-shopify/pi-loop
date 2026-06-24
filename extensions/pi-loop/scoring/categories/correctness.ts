import { buildCategory } from "../category.ts";
import { countStatus, nonEmpty } from "../evidence.ts";
import type { CategoryScore, LoopScoreInput } from "../types.ts";

export function scoreCorrectness(input: LoopScoreInput): CategoryScore {
  const requirements = input.requirements ?? [];
  const total = requirements.length;
  const met = countStatus(requirements, "met");
  const partial = countStatus(requirements, "partial");
  const evidence: string[] = [];
  const gaps: string[] = [];
  let score = 0;

  if (nonEmpty(input.goal)) score += 3;
  else gaps.push("Goal is missing.");

  if (nonEmpty(input.summary)) score += 3;
  else gaps.push("Result summary is missing.");

  if (total > 0) {
    const coverage = (met + partial * 0.5) / total;
    score += coverage * 10;
    evidence.push(`${met}/${total} requirements met${partial > 0 ? `, ${partial} partial` : ""}.`);
    for (const requirement of requirements) {
      if (requirement.status === "missing" || requirement.status === "unknown") gaps.push(`Requirement not proven: ${requirement.description}`);
    }
  } else {
    gaps.push("No explicit requirements were mapped.");
  }

  const unresolved = (input.risks ?? []).filter((risk) => !risk.resolved && risk.severity === "blocker");
  if (unresolved.length === 0) score += 2;
  else gaps.push(`${unresolved.length} unresolved blocker risk(s).`);

  if ((input.artifacts ?? []).length > 0) {
    score += 2;
    evidence.push(`${input.artifacts!.length} artifact(s) listed.`);
  } else {
    gaps.push("No artifacts or file paths were listed.");
  }

  return buildCategory("correctness", score, evidence, gaps);
}
