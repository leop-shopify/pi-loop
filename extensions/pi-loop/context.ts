import { buildTargetContextSnapshot, formatTargetContext, type TargetContextSnapshot } from "./target-context.ts";
import type { LoopScoreEntry } from "./state.ts";

export type LoopContextSnapshot = TargetContextSnapshot;

export function buildLoopContextSnapshot(cwd: string, goal: string, priorScores: LoopScoreEntry[] = []): LoopContextSnapshot {
  return buildTargetContextSnapshot({ cwd, goal, priorScores });
}

export function formatLoopContext(snapshot: LoopContextSnapshot): string {
  return formatTargetContext(snapshot);
}
