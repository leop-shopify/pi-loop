# Making pi-loop the best loop/goal extension for Pi — research and gap analysis (July 2026)

This document records the research behind the July 2026 improvement pass: current agent-loop trends, the Ralph loop's solidity model, a survey of competing Pi extensions, and an honest assessment of pi-loop against four questions — first-entry robustness for any model, Ralph-style solidity, experiment tracking, and turning text objectives into numbers.

## 1. Trends: loop engineering replaced one-shot prompting

The 2026 consensus ("loop engineering") treats the LLM as a component inside a self-correcting state machine. The unit of value is the trajectory, not the response: a bug on turn one is fine if the system detects and fixes it by turn four. Three design rules recur across the literature:

1. **High-fidelity feedback or nothing.** A loop without real signals (terminal output, benchmarks, browser, eval model) "is just a very expensive hallucination". pi-loop's evidence-inference from tool history follows this rule; the new measured-metrics channel strengthens it.
2. **Verifier/judge separation.** For completion claims, a second judgment (rubric verifier, cross-model judge, independent auditor) is the standard fix for executor self-satisfaction.
3. **State outlives context.** Progress must live in files/git, not in the conversation window, so any fresh model can resume.

## 2. The Ralph loop: why it is solid, and where pi-loop stands

Ralph (Geoffrey Huntley, mid-2025) is `while :; do cat PROMPT.md | agent; done`. Its solidity comes from five properties:

| Ralph property | Mechanism | pi-loop equivalent |
| --- | --- | --- |
| Fresh context per iteration | New session each loop; no compaction events | Partial — same session, but continuation prompts are rebuilt from persisted state, not raw history |
| Progress in files/git, not context | Commits, fix_plan.md, AGENT.md | `log.jsonl` (config/score/event entries) + session restore |
| One task per iteration | Explicit prompt constraint | "Verifiable slice" per turn + planTasks statuses |
| Tests as backpressure | Test passage gates advancement | Observed checks from tool history + hard caps |
| Hard iteration cap | `--max-iterations` | 12-turn / 10-minute / 5-run caps |

Ralph's known fragilities — placeholder implementations, false "feature missing" conclusions from search, premature completion claims — are what pi-loop's scorer, premature-stop detection, and acceptance gate target. pi-loop's refined continuation prompt is arguably *stronger* than Ralph's identical-prompt refeed (it carries plateau analysis, blockers, and best-attempt-to-beat), at the cost of in-session context accumulation.

**Gap to close later:** a compaction-recovery prompt (re-read persisted loop state after Pi auto-compaction), and an optional fresh-session run mode for true Ralph-style restarts.

## 3. Pi ecosystem survey

The catalog at pi.dev lists 17+ Ralph-style packages plus adjacent loop/goal tools. The distinctive mechanics worth learning from:

| Package | Distinctive mechanic |
| --- | --- |
| `@tmustier/pi-ralph-wiggum` (~2.2K/mo) | `.ralph/<name>.md` task files, multiple parallel loops, periodic self-reflection iterations |
| `pi-autoresearch` (~3K/mo) | `METRIC name=number` measurement contract, direction (lower/higher), baseline vs best, keep/discard verdicts, MAD-based confidence vs noise floor, `.auto/prompt.md` living doc that survives context resets, compaction-idle detection |
| `pi-until-done` | Cross-model LLM judge gates every completion; `verifyCommand` contract; phase glyphs (RED/GREEN/REFACTOR) |
| `pi-goal-x` | Schema-gated lifecycle tools (agent only sees phase-appropriate tools), immutable user-owned objective, independent auditor agent on completion, disk-backed goals in `.pi/goals/` |
| `@mikefreno/ralpi` | DAG-based task dependency resolution from PRDs |
| `rezero` | Review-and-retry loop with checkpoint restarts |

pi-loop's differentiators today: deterministic rule-based scoring with hard caps (no LLM judge cost), acceptance-criteria discovery gate with user confirmation, bounded best-of-K runs, ACE playbook integration, and the richest persisted telemetry (per-turn durations, outcomes, verifier findings).

## 4. First entry with any model

Assessment: the kickoff path is model-agnostic in structure (everything the model needs is in the prompt: goal, context snapshot, contract, budget), but three things made first entries weaker for smaller models, and one is now fixed:

- **Fixed:** vague progress framing. Numeric objectives are now parsed from the goal at `/loop` time (`objectives.ts`), echoed in kickoff/system prompts with a measurement rule, and any model — from the very first entry — is told exactly which numbers to measure and report. Real measured deltas become the primary progress signal instead of the internal heuristic score alone.
- Remaining: the feedback contract is instruction-heavy; schema-gating (only exposing `loop_feedback` fields valid for the current phase, as pi-goal-x does) would replace prompt-wall compliance with mechanical enforcement.
- Remaining: no on-disk living document (`.pi/` or project-local) a fresh model can re-read after compaction; state restores from `log.jsonl` only on session events.

## 5. Experiment tracking

Assessment before this pass: every turn was logged (score, outcome, blockers, categories, verifier findings, durations) — good audit trail, but no *measured quantities*, no per-turn hypothesis, no keep/discard verdict, and no noise estimate.

Now: `loop_feedback.metrics` records measured values per turn; they persist on score entries in `log.jsonl`, render in the feedback response with baseline deltas and target status, and feed a "Measured metric trend" section in continuation prompts. This makes experiments comparable across turns by real numbers.

Future work (in priority order): per-turn `hypothesis` + `verdict` (keep/discard) fields; MAD-based confidence vs noise floor when an objective has 3+ measurements (pi-autoresearch's model); optional auto-commit per kept experiment so git bisecting maps to the experiment log.

## 6. Numbers from text objectives (implemented)

`extractNumericObjectives(goal)` in `extensions/pi-loop/objectives.ts` parses:

- percent changes: "reduce bundle size by 20%" → decrease 20%
- max thresholds: "keep p95 under 200ms", "up to 500kb" → ≤ value
- min thresholds: "coverage at least 90%" → ≥ value
- explicit baselines: "cut runtime from 40s to 25s" → target 25s with known baseline 40s
- targets: "bring memory down to 150mb" → directional target

Each objective carries id (`O1`...), metric label, kind, direction, value, unit, optional fromValue. `objectiveStatus()` computes the target value, satisfaction, and percent of gap closed from baseline. Overlapping/duplicate matches are deduped; extraction is capped at 5 objectives. The model reports measurements by objective id; matching also works by fuzzy metric-name containment.

Design choice: objectives are advisory feedback, not stop conditions — consistent with pi-loop's "positive progress never stops the loop" rule. A met target is reported as `met` but the loop still runs to its configured limits.

Trust model: a metric is verified only when its value appears in the tool output observed during the turn; `sourceCommand` is provenance, not proof (a named command must not be able to launder an arbitrary value). Unverified metrics are labeled in the response and excluded from baselines, trends, and the reported-objective check — displayed but quarantined, because observed evidence is truncated (last 8 checks, 500 chars each) and hard rejection of the display would hide honest measurements; quarantine keeps them from poisoning history either way. Metric names matching an objective are canonicalized to the objective id, and compatible units (time and size families) are converted to the objective's unit before target comparison; incompatible units yield `not comparable` rather than a raw-number verdict.

## 7. Roadmap status (all items closed as of 2026-07-02)

1. **Compaction resilience — implemented.** The per-turn system prompt add-on is rebuilt from persisted state on every `before_agent_start` and now carries the confirmed acceptance criteria and plan-task statuses in addition to goal, context, limits, and rules. Continuation prompts are likewise regenerated from `log.jsonl`-backed state. Nothing the loop depends on lives only in old conversation turns, so compaction cannot strand it.
2. **Schema-gated feedback phases — closed via mechanical execute-side gating.** The failure mode schema gating targets (scoring before acceptance is confirmed) is enforced inside the tool: `loop_feedback` rejects any checkpoint until confirmed criteria plus plan tasks arrive. Dynamically swapping the published TypeBox schema per phase would need first-class Pi API support and adds no additional enforcement beyond the existing hard gate.
3. **Hypothesis + verdict experiment fields — implemented.** `loop_feedback` accepts a one-line `hypothesis` and a `keep`/`discard` `verdict`; both persist on score entries in `log.jsonl` and are echoed in continuation prompts ("Previous hypothesis: … (verdict: discard)") and recent-feedback history, so experiments stay comparable across turns and post-hoc analysis can replay the decision trail.
4. **Confidence vs noise floor — implemented.** With 3+ verified measurements of a metric, trend lines report MAD-based confidence (best improvement ÷ noise floor); below 1x noise the prompt advises re-measuring before trusting the gain, 1–2x is marked marginal. Constant series (MAD = 0) yield no confidence claim rather than a fake one.
5. **Completion judging — implemented as confirmation passes + independent audit lanes.** Completion claims trigger fresh-evidence confirmation passes with falsification framing; the confirmation prompt requires at least one pass to run as an independent read-only audit lane through spawned-agent delegation when available (its `report_and_exit` output is observed as review evidence), and `--runs > 1` turns the post-claim run into an independent audit. A configurable cross-model judge remains a possible refinement, not a gap: the independent-verification behavior it buys is delivered by the audit lane.
6. **Domain-aware scoring rules — implemented.** The score input carries a `domain.softwareProject` hint computed by the extension from the target context (package manager, scripts, existing code files, checks — never model-supplied). With no code domain and no code artifacts, code-centric rule families stay silent on non-code goals; the moment real code artifacts are touched, the caps apply regardless of the hint, so the relaxation cannot be gamed.
7. **Fresh-session run mode — closed by design.** pi-loop deliberately binds loops to the session that started them and avoids forking sessions (README, best-of-K section). The Ralph benefits fresh sessions buy — clean context, state rehydrated from disk — are delivered by the compaction-proof per-turn add-on, persisted `log.jsonl` state, and independent audit runs; a literal fresh-session restart would require Pi session-forking APIs and contradicts the extension's session-binding safety model.
