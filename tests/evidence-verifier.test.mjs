import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scoreLoopResult, verifyScoreEvidence } from "../extensions/pi-loop/scoring-heuristics.ts";
import { strongInput } from "./helpers/scoring-fixtures.mjs";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-loop-verifier-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("evidence verifier rejects missing and escaping artifact paths", () => {
  withTempDir((dir) => {
    const findings = verifyScoreEvidence({ ...strongInput, artifacts: [{ path: "missing.ts", purpose: "missing", kind: "source" }] }, { cwd: dir });
    const escaping = verifyScoreEvidence({ ...strongInput, artifacts: [{ path: "../escape.ts", purpose: "escape", kind: "source" }] }, { cwd: dir });

    assert.ok(findings.some((finding) => finding.code === "artifact_missing"));
    assert.ok(escaping.some((finding) => finding.code === "artifact_outside_cwd"));
  });
});

test("verifier findings cap the score before definition of done can pass", () => {
  withTempDir((dir) => {
    writeFileSync(join(dir, "source.ts"), "export {};\n");
    const result = scoreLoopResult({
      ...strongInput,
      artifacts: [{ path: "source.ts", purpose: "source", kind: "source" }],
      checks: [{ name: "tests", status: "passed", kind: "test", required: true, command: "pnpm test", evidence: "claimed" }],
    }, undefined, { cwd: dir });

    assert.equal(result.outcome, "invalid_evidence");
    assert.ok(result.score <= 65);
    assert.ok(result.verifierFindings.some((finding) => finding.code === "check_missing_zero_exit"));
  });
});
