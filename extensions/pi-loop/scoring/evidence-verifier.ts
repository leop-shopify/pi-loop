import * as fs from "node:fs";
import * as path from "node:path";

import type { ArtifactEvidence, CheckEvidence, LoopScoreInput, ReviewGateEvidence } from "./types.ts";
import type { EvidenceVerificationFinding } from "./verification-finding.ts";

export interface EvidenceVerifierOptions {
  cwd?: string;
}

export function verifyScoreEvidence(input: LoopScoreInput, options: EvidenceVerifierOptions = {}): EvidenceVerificationFinding[] {
  const findings: EvidenceVerificationFinding[] = [];

  for (const artifact of input.artifacts ?? []) verifyArtifact(findings, artifact, options.cwd);
  for (const check of input.checks ?? []) verifyCommandEvidence(findings, "check", check);
  for (const gate of input.reviewGates ?? []) verifyReviewGateEvidence(findings, gate);

  return findings;
}

export function verifierFindingCaps(findings: EvidenceVerificationFinding[]) {
  return findings.map((finding) => ({ value: finding.cap, reason: finding.message, evidence: finding.evidence }));
}

function verifyArtifact(findings: EvidenceVerificationFinding[], artifact: ArtifactEvidence, cwd: string | undefined): void {
  if (!cwd) return;
  const resolved = path.resolve(cwd, artifact.path);
  const root = path.resolve(cwd);
  if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
    findings.push({ code: "artifact_outside_cwd", severity: "blocker", message: `Artifact path escapes the working directory: ${artifact.path}.`, cap: 65 });
    return;
  }
  if (!fs.existsSync(resolved)) findings.push({ code: "artifact_missing", severity: "blocker", message: `Artifact path does not exist: ${artifact.path}.`, cap: 65 });
}

function verifyCommandEvidence(findings: EvidenceVerificationFinding[], label: string, evidence: CheckEvidence): void {
  if (evidence.status !== "passed") return;
  if (!evidence.command?.trim()) {
    findings.push({ code: `${label}_missing_command`, severity: "blocker", message: `Passed ${label} lacks a command: ${evidence.name}.`, cap: 65, evidence: evidence.evidence });
    return;
  }
  if (evidence.exitCode !== 0) {
    findings.push({ code: `${label}_missing_zero_exit`, severity: "blocker", message: `Passed ${label} lacks zero-exit proof: ${evidence.name}.`, cap: 65, evidence: evidence.evidence });
  }
  if (!evidence.evidence?.trim()) findings.push({ code: `${label}_missing_output`, severity: "important", message: `Passed ${label} lacks output evidence: ${evidence.name}.`, cap: 80 });
}

function verifyReviewGateEvidence(findings: EvidenceVerificationFinding[], gate: ReviewGateEvidence): void {
  if (gate.status !== "passed") return;
  if (gate.command?.trim()) {
    verifyCommandEvidence(findings, "review gate", gate);
    return;
  }
  if (!gate.url?.trim() && !gate.evidence?.trim()) findings.push({ code: "review_gate_unverifiable", severity: "important", message: `Passed review gate lacks command, URL, or evidence: ${gate.name}.`, cap: 85 });
}
