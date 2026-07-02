import type { ArtifactEvidence, CheckEvidence, CheckKind, LoopScoreInput, RequirementEvidence } from "./types.ts";

export const SECURITY_CHECK_KINDS = new Set<CheckKind>(["security", "dependency", "dependency_audit"]);
export const REQUIRED_FAILURE_KINDS = new Set<CheckKind>(["test", "typecheck", "lint", "build", "format", "coverage", "migration_safety", "ci"]);
export const RAILS_PATH = /^(app\/(models|controllers|jobs|policies|mailers|services|graphql|queries|workers|serializers|presenters|helpers|views|channels|mailboxes|validators|components|forms|interactors|operations|admin)|db\/(migrate|post_migrate|data|seeds|schema\.rb)|config\/(routes\.rb|initializers)|lib\/tasks)\b/;
export const MIGRATION_PATH = /^(db\/(migrate|post_migrate|data)\b|db\/schema\.rb$)/;
export const JOB_PATH = /^app\/(jobs|workers|sidekiq|consumers)\b/;
export const AUTH_PATH = /^(app\/(controllers|policies|graphql|admin)|config\/routes\.rb)\b/;
export const QUERY_PATH = /^(app\/(models|controllers|services|queries|graphql)|db\/(migrate|post_migrate|data)\b)/;
export const DOC_OR_TEST_PATH = /(\.md$|^docs\/|^test\/|^tests\/|^spec\/|\.test\.|\.spec\.|_test\.|_spec\.|^generated\/|^dist\/|\.generated\.)/;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function boolScore(value: boolean | undefined, points: number): number {
  return value === true ? points : 0;
}

export function nonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function countStatus(requirements: RequirementEvidence[] | undefined, status: RequirementEvidence["status"]): number {
  return (requirements ?? []).filter((requirement) => requirement.status === status).length;
}

export function checkHasCommandEvidence(check: CheckEvidence): boolean {
  return nonEmpty(check.command) && nonEmpty(check.evidence) && (check.exitCode === undefined || check.exitCode === 0);
}

export function hasPassedCheck(input: LoopScoreInput): boolean {
  return (input.checks ?? []).some((check) => check.status === "passed" && checkHasCommandEvidence(check));
}

export function failedRequiredChecks(input: LoopScoreInput): CheckEvidence[] {
  return (input.checks ?? []).filter((check) => {
    if (check.status !== "failed" || check.resolved) return false;
    return check.required === true || (check.kind !== undefined && (REQUIRED_FAILURE_KINDS.has(check.kind) || SECURITY_CHECK_KINDS.has(check.kind)));
  });
}

export function hasConcreteVerification(input: LoopScoreInput): boolean {
  return hasPassedCheck(input);
}

export function hasConcreteTestOrCoverageVerification(input: LoopScoreInput): boolean {
  return (input.checks ?? []).some((check) => isTestOrCoverageCheck(check) && check.status === "passed" && checkHasCommandEvidence(check));
}

export function isTestOrCoverageCheck(check: CheckEvidence): boolean {
  if (check.kind === "test" || check.kind === "coverage") return true;
  return /\b(test|spec|coverage|cov)\b/i.test(`${check.name} ${check.command ?? ""}`);
}

export function artifactPaths(input: LoopScoreInput): string[] {
  return (input.artifacts ?? []).map((artifact) => normalizeArtifactPath(artifact.path));
}

export function normalizeArtifactPath(filePath: string): string {
  return filePath.replace(/^\.\//, "").replace(/^\/+/g, "");
}

export function isDocsOnlyArtifact(artifact: ArtifactEvidence): boolean {
  return artifact.kind === "docs" || DOC_OR_TEST_PATH.test(normalizeArtifactPath(artifact.path));
}

export function isExecutableArtifact(artifact: ArtifactEvidence): boolean {
  if (artifact.kind === "source" || artifact.kind === "migration" || artifact.kind === "script") return true;
  if (artifact.kind === "docs" || artifact.kind === "test" || artifact.kind === "generated") return false;
  return !DOC_OR_TEST_PATH.test(normalizeArtifactPath(artifact.path));
}

export function hasProductionArtifacts(input: LoopScoreInput): boolean {
  const artifacts = input.artifacts ?? [];
  if (artifacts.length === 0) return input.domain?.softwareProject ?? true;
  return artifacts.some(isExecutableArtifact);
}

export function isDocsOnlyChange(input: LoopScoreInput): boolean {
  const artifacts = input.artifacts ?? [];
  return artifacts.length > 0 && artifacts.every(isDocsOnlyArtifact);
}

export function hasRailsArtifacts(input: LoopScoreInput): boolean {
  return artifactPaths(input).some((filePath) => RAILS_PATH.test(filePath));
}

export function hasArtifactMatching(input: LoopScoreInput, pattern: RegExp): boolean {
  return artifactPaths(input).some((filePath) => pattern.test(filePath));
}

export function operabilityRelevant(input: LoopScoreInput): boolean {
  const text = [
    input.goal,
    input.summary,
    input.design?.evidence,
    ...(input.artifacts ?? []).flatMap((artifact) => [artifact.purpose, artifact.evidence]),
  ].join(" ");
  const paths = artifactPaths(input).join(" ");
  return /\b(loop|auto-?resume|restart|retry|background job|worker|queue|cron|scheduler|daemon|long-running|timeout|time limit|turn limit|rate limit|rollback|recovery|persist|state|logging|log|human stop|manual stop)\b/i.test(text) || /\b(loop|runtime-store|controller|events|queue|worker|job|scheduler|cron|log|state|daemon|retry)\b/i.test(paths);
}
