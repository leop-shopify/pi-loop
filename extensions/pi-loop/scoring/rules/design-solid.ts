import { hasProductionArtifacts } from "../evidence.ts";
import type { Cap, DesignEvidence, LoopScoreInput } from "../types.ts";
import type { ScoringRule } from "./types.ts";

export const designSolidRule: ScoringRule = {
  name: "design-solid",
  evaluate(input: LoopScoreInput): Cap[] {
    const caps: Cap[] = [];
    const design = input.design;

    if (design?.noGodFiles === false || design?.responsibilitiesSplit === false || design?.singleResponsibility === false || design?.boundariesClear === false) {
      caps.push({ value: 80, reason: "Design evidence shows responsibility pile-on, god file, or unclear boundaries." });
    }

    if (hasProductionArtifacts(input) && missingProductionDesignEvidence(design)) {
      caps.push({ value: 85, reason: "Production change is missing no-god-file, single-responsibility, or boundary evidence." });
    }

    return caps;
  },
};

function missingProductionDesignEvidence(design: DesignEvidence | undefined): boolean {
  if (!design) return true;
  const singleResponsibility = design.singleResponsibility ?? design.responsibilitiesSplit;
  return design.noGodFiles !== true || singleResponsibility !== true || design.boundariesClear !== true;
}
