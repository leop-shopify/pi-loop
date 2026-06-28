# pi-loop

`pi-loop` is a Pi extension for bounded, progress-guided software engineering loops. The first scored turn becomes the hidden baseline; later turns use scoring as feedback and keep exploring until configured safety limits or the user stops the loop. Continuation prompts can enrich the next attempt with a compact ACE playbook from `pi-ace-adapter` when project ACE storage is enabled.

It is meant for quality work where “looks done” is not enough: test improvement, refactors, Rails hardening, verification cleanup, review-gate fixes, and similar engineering tasks.

## Screenshot

![pi-loop running in Pi with the progress panel and step history](docs/images/pi-loop-running.png)

## What the package installs

This package registers pi-loop plus the bundled ACE adapter resources:

```json
{
  "pi": {
    "extensions": [
      "./node_modules/pi-ace-adapter/dist/index.js",
      "./extensions/pi-loop/index.ts"
    ],
    "skills": ["./node_modules/pi-ace-adapter/skills"],
    "prompts": ["./node_modules/pi-ace-adapter/prompts"]
  }
}
```

The extensions add:

| Surface | Name | Purpose |
| --- | --- | --- |
| Command | `/loop` | Starts, stops, clears, and reports loop status. |
| Tool | `score_loop_result` | Records concrete engineering evidence and reports feedback; progress is an observation, not a stop command. |
| UI | floating right-side panel | Shows runtime data, current prompt, timing, tokens, and bounded step history. |
| State | `~/.pi/agent/pi-loop/projects/<project>/log.jsonl` | Persists loop config, internal measurements, progress entries, and stop events in Pi's global agent directory. Active loops are bound to the Pi session that started them. |

## Install

### ACE adapter dependency

This branch expects the sibling checkout `~/Poetry/pi-ace-adapter` and declares it as `pi-ace-adapter: file:../pi-ace-adapter` for local development. Keep the two checkouts side by side when installing locally. Before publishing or installing from a remote, replace that file dependency with the adapter's git or registry spec. pi-loop loads the adapter extension resources from `node_modules`, imports the stable `pi-ace-adapter/context` resolver, and launches ACE through the adapter's daemon-style runner.

Local development install:

```bash
pi install ~/src/pi-loop
```

Temporary one-off run without installing:

```bash
pi -e ~/src/pi-loop
```

Use the package directory, not only `extensions/pi-loop/index.ts`, so Pi also loads the ACE adapter extension, `/ace` commands, skills, prompts, and daemon-launch event listener.

After publishing to a git remote, install with:

```bash
pi install https://github.com/<owner>/pi-loop
```

For project-local installation, run the install command from the target repository with `-l`:

```bash
pi install -l ~/src/pi-loop
```

## Commands

```text
/loop <goal>
/loop <goal> --minutes=10 --turns=12 --runs=2
/loop status
/pi-loop hide
/pi-loop show
/pi-loop toggle
/loop off
/loop clear

/ace status
/ace setup
/ace import-playbook <path> [name]
/ace use <name>
/ace start [playbook] [--mode offline|online|eval_only]
```

Shortcut: `Ctrl+Alt+L` toggles the floating panel without changing loop execution.

## ACE general-use assets

The package ships general, domain-neutral ACE assets under `ace/`:

| Path | Purpose |
| --- | --- |
| `ace/playbooks/pi-loop-general.md` | A reusable software-engineering loop playbook for bug fixes, tests, refactors, docs/config/package work, and ACE integration work. |
| `ace/datasets/general-loop-proof.jsonl` | ACE-shaped general loop examples with `context`, `question`, `target`, and `metadata.domain = general_engineering`. |
| `ace/proof/verification.json` | Saved proof metadata for the local verification commands and behaviors proven by the ACE integration work. |

These assets intentionally avoid single-domain prompts or task-specific evaluation commands. Import the playbook with `/ace import-playbook ace/playbooks/pi-loop-general.md default`, enable it with `/ace use default`, and use `/ace start default` to run the adapter's detached ACE bridge.

Defaults:

| Setting | Default |
| --- | --- |
| Timebox | 10 minutes for scored loop work (capped); optional initial research gate has a 30-minute cap when justified by prompt complexity or missing information. |
| Turn limit | 12 total attempts |
| Run count | 1 |

## Paper model mapped to pi-loop

`pi-loop` adapts the ComPilot paper's two-phase loop: context initialization, then iterative optimization with deterministic scoring feedback.

| Paper concept | ComPilot behavior | pi-loop equivalent |
| --- | --- | --- |
| Input program | A loop nest extracted from a source program. | A software engineering goal plus the repository state the agent inspects. |
| Context prompt | Fixed system instructions describing role, input format, output format, action space, hardware, and crash handling. | `systemPromptAddon()` plus `scoringRubricSummary()`: role, limits, scoring contract, hard rules, required evidence, and stop conditions. |
| Target loop presentation | The selected loop nest is normalized and shown to the LLM. | `/loop` builds a bounded context snapshot: cwd, package manager, package scripts, git branch/status, changed files, and recent scores. The agent still chooses the exact files to inspect. |
| Initial analysis | The LLM must analyze the loop before proposing transformations. | The kickoff prompt explicitly requires analysis of problem, files, acceptance criteria, verification, and whether the first request needs a separate post-context research gate before implementation. |
| Schedule proposition | The LLM proposes transformations in a structured format. | `score_loop_result` requires `attempt.rationale` and `attempt.fullPlan` evidence for production changes, giving pi-loop a visible plan/attempt analogue without restricting all Pi tools. |
| Response parser | Extracts the schedule from the LLM response. | TypeBox validates the `score_loop_result` input schema, including enum-safe attempt, check, artifact, risk, and review-gate evidence. |
| Validity and legality checks | Lightweight syntax checks plus compiler legality checks. | Strict schema validation, independent evidence verification, and scoring hard caps flag or cap weak evidence and unresolved risks; pi-loop still does not formally prove arbitrary code safety. |
| Compiler/runtime feedback | Reports invalid, illegal, solver failure, crash, or successful speedup/slowdown. | Reports typed outcome plus progress/evidence feedback: baseline recorded, new-best progress, verifier findings, blockers, strengths, and next actions. |
| Optimization history | Feedback is appended to the dialogue so the next iteration can adapt. | Progress entries are appended to `~/.pi/agent/pi-loop/projects/<project>/log.jsonl`; continuation prompts are rebuilt as refined prompts with what was tried, what did not improve, plateau/repeat signals, best attempt to beat, blockers, next actions, budget, and compact ACE playbook context from `pi-ace-adapter` when enabled. |
| Stopping condition | Stop command or iteration limit; the framework can push past premature LLM stop attempts. | A 10-minute capped timebox for scored loop work, optional 30-minute initial research gate only when justified, 12-attempt global turn budget, run limit, user stop, or repeated missing scorer calls. Positive heuristic progress alone never stops the loop. |

## Runtime context steps

1. `/loop <goal>` parses command input into a loop config: goal, max turns, max runs, and max minutes.
2. pi-loop builds a bounded context snapshot from the current working directory, package scripts, git state, changed files, and prior scored attempts.
3. The kickoff instructions require an initial complexity gate after context capture. If the first request genuinely needs extra data, information, or research that the captured context does not provide, the agent may take a separate 30-minute research step, spawn focused agents to gather and organize the content, explain why the gate is needed, and then start the official scored loop from the synthesized context. This is not a default excuse to spend time or tokens.
4. The config plus context snapshot and current Pi session id are appended to `~/.pi/agent/pi-loop/projects/<project>/log.jsonl` as a `config` entry.
5. `score_loop_result` is activated for the session.
6. pi-loop requests a daemon-ish ACE run through `pi-ace-adapter` when ACE storage is enabled and the selected playbook exists. The loop does not wait for ACE completion; output and metadata paths are logged.
7. A kickoff prompt is sent as a normal user message. It includes the context snapshot, compact ACE context when enabled, and asks the agent to analyze first, apply the complexity/research gate only when justified, then work, then score.
8. On every `before_agent_start`, pi-loop injects a system prompt add-on containing the active goal, context snapshot, limits, scoring hard rules, and evidence requirements.
9. On `agent_start`, pi-loop increments the turn counter, appends a `turn_started` event, and records how many score entries existed before the turn.
10. The agent works with normal Pi tooling. pi-loop does not sandbox tools or prescribe the implementation path.
11. Before claiming completion, the agent must call `score_loop_result` with structured attempt and evidence.
12. The score tool verifies evidence, classifies the outcome, appends a progress entry to `~/.pi/agent/pi-loop/projects/<project>/log.jsonl`, updates the widget, and returns progress feedback. The first call records only the baseline.
13. On `agent_end`, pi-loop checks whether the turn produced a score:
    - if not, it schedules a missing-score prompt
    - it schedules a refined continuation prompt using tried actions, non-improvements, plateau/repeat analysis, blockers, next actions, remaining budget, and compact ACE context when enabled
    - if a safety limit is hit, it appends a stop event, sends a concise TL;DR summary with each loop step taken, disables the score tool, and clears the widget
14. On the next event in the same Pi session, pi-loop reconstructs active state from `~/.pi/agent/pi-loop/projects/<project>/log.jsonl` and resumes the widget/tool state when limits have not been reached. A different Pi session ignores that active loop and must start its own `/loop`.

## Input structure

There are two inputs: the command input and the scoring input.

### `/loop` command input

```text
/loop <goal> [--minutes=10] [--turns=12] [--runs=1]
/loop <goal> [--file=path] [--symbol=Name] [--check="pnpm test tests/foo.test.mjs"]
```

Parsed config:

```ts
{
  goal: string;
  maxMinutes: number;
  maxTurns: number;
  maxRuns: number;
  startedAt: number;
  sessionId: string;
  targetContext: TargetContextSnapshot;
}
```

`--turns` is per run when `--runs > 1`, but it is capped at 12 and `runs * turns` must stay within the 12-attempt global safety cap. `--minutes` remains a global timebox across scored loop work and is capped at 10 minutes; a justified initial research gate may use a separate 30-minute budget when the first prompt needs missing data or research before the scored loop starts. Unfinished scored-loop work should move to the next attempt instead of stretching the turn. `--runs` is capped at 5.

### `score_loop_result` tool input

The scorer input is intentionally evidence-heavy. Missing fields are allowed by the schema, but missing important evidence lowers the internal measurement or triggers hard caps. The internal measurement is not shown as loop progress; progress is always percent change over the first scored attempt.

```ts
{
  summary: string;
  attempt?: { rationale: string; fullPlan: string; actionsTaken?: string[]; stopIntent?: "continue" | "claim_done" | "blocked"; reusedPriorPlan?: boolean };
  artifacts?: Array<{ path: string; purpose: string; evidence?: string; kind?: "source" | "test" | "migration" | "config" | "docs" | "generated" | "script" }>;
  requirements?: Array<{ description: string; status: "met" | "partial" | "missing" | "unknown"; critical?: boolean; evidence?: string }>;
  checks?: Array<{ name: string; status: "passed" | "failed" | "not_run" | "unknown"; kind?: "test" | "typecheck" | "lint" | "format" | "build" | "coverage" | "security" | "dependency" | "dependency_audit" | "migration_safety" | "ci" | "review"; required?: boolean; scope?: "targeted" | "full" | "ci"; command?: string; exitCode?: number; url?: string; evidence?: string; resolved?: boolean }>;
  tests?: TestEvidence;
  design?: DesignEvidence;
  rails?: RailsEvidence;
  operability?: OperabilityEvidence;
  reviewGates?: ReviewGateEvidence[];
  risks?: Array<{ severity: "blocker" | "important" | "minor"; kind?: "correctness" | "security" | "authorization" | "data_integrity" | "performance" | "maintainability" | "operability"; description: string; evidence?: string; resolved?: boolean }>;
}
```

Important nested evidence:

| Field | Purpose |
| --- | --- |
| `attempt.rationale` and `attempt.fullPlan` | Provides the visible plan/attempt record analogous to a paper schedule proposal. |
| `tests.observableAssertions` / `tests.assertionsExerciseBehavior` | Proves tests assert external behavior, not implementation details. |
| `tests.changedCodeCovered` / `tests.wouldFailOnBug` | Proves tests cover the changed behavior or target bug. |
| `tests.usesMocksForOwnedCode` and `tests.mockOnly` | Must be explicitly clean for high scores. |
| `design.singleResponsibility`, `design.noGodFiles`, `design.boundariesClear` | Proves the change avoids god files and responsibility pile-on. |
| `rails.relevant` | Must be truthful when Rails files are touched. |
| `reviewGates` | Captures CI, required checks, security scans, dependency audits, or equivalent automated gates. |
| `risks` | Captures unresolved blockers and important follow-up risks. |

## Output structure

### Tool response

`score_loop_result` returns human-readable text plus structured details.

Text response shape:

```text
Progress: <baseline recorded|+N.N% over baseline> (<baseline recorded; continue|new best recorded; continue|continue>)
Outcome: <typed outcome>
Blockers:
- <severity>: <message>
Verifier findings:
- <severity>: <message>
Next actions:
- <action>
```

Structured details keep internal measurement fields for persistence and automated checks; the UI and text response do not render those fields. `passedDefinition` is retained as a compatibility field for new-best feedback and is not a loop stop command.

```ts
{
  result: {
    score: number;
    rawScore: number;
    targetScore: number;
    baselineScore: number | null;
    progressPercent: number | null;
    passedDefinition: boolean;
    improvement: number | null;
    categories: Array<{ key: string; label: string; score: number; max: number; evidence: string[]; gaps: string[] }>;
    blockers: Array<{ severity: "blocker" | "important" | "minor"; message: string; evidence?: string }>;
    strengths: string[];
    nextActions: string[];
    outcome: "invalid_evidence" | "verification_failed" | "review_gate_failed" | "safety_blocked" | "tool_or_runtime_failure" | "successful_improvement" | "successful_no_improvement" | "needs_iteration";
    verifierFindings: Array<{ code: string; severity: "blocker" | "important" | "minor"; message: string; evidence?: string; cap: number }>;
  };
  loopState: {
    active: boolean;
    goal: string | null;
    targetScore: number;
    maxTurns: number;
    maxMinutes: number;
    startedAt: number | null;
    turnsStarted: number;
    results: unknown[];
    stopReason: string | null;
  };
}
```

### Persistent log output

`~/.pi/agent/pi-loop/projects/<project>/log.jsonl` stores three entry kinds:

```ts
{ type: "config"; schemaVersion?: 2; goal: string; targetScore: number; maxTurns: number; maxMinutes: number; maxRuns?: number; startedAt: number; sessionId?: string; targetContext?: TargetContextSnapshot }
{ type: "score"; schemaVersion?: 2; run?: number; turn: number; globalTurn?: number; timestamp: number; summary: string; score: number; rawScore: number; targetScore: number; baselineScore?: number | null; progressPercent?: number | null; passedDefinition: boolean; improvement: number | null; blockers: unknown[]; strengths?: string[]; nextActions: string[]; categories: unknown[]; outcome?: string; verifierFindings?: unknown[]; attempt?: unknown; result?: unknown }
{ type: "event"; schemaVersion?: 2; timestamp: number; event: "stopped" | "run_started" | "run_stopped" | "turn_started" | "missing_score" | "premature_stop" | "ace_run_started" | "ace_run_completed" | "ace_run_failed" | "ace_run_skipped"; reason?: string; run?: number; turn?: number; globalTurn?: number; details?: Record<string, unknown> }
```

### UI output

The floating right-side panel renders at 25% terminal width and 95% terminal height. It shows runtime data, a current prompt section summarized into useful execution news (`Now`, `Signal`, `Plan`, `Budget`, `Expected`) instead of raw “continue the loop” boilerplate, recent turn durations that wrap across lines instead of truncating, and the full runtime step history so the README model is visible while the loop runs. Toggle the panel with `Ctrl+Alt+L`, `/pi-loop hide`, `/pi-loop show`, or `/pi-loop toggle`:

```text
╭──────────── pi-loop <status> ────────────╮
│──────────── data ────────────            │
│turn: <total>/<limit> total, run <n>/<max> │
│time: <elapsed>/<limit>m all, current <n> │
│last turn: <duration|none>                │
│tokens: <used>/<window> <percent>         │
│progress: <baseline|+N.N% over baseline>  │
│best: <+N.N% over baseline run n|none>    │
│ace: <not launched|running pid n|skipped> │
│recent: #1 9m 12s, #2 8m 03s             │
│        #3 10m 00s, #4 2m 17s            │
│──────── current prompt ────────          │
│Now: continue the loop with a concrete    │
│     plan for <goal>                      │
│Signal: <last progress or baseline>       │
│Plan: <next action to try>                │
│Expected: finish one verifiable slice...  │
│──────── step history ────────            │
│  07 done  start turn - turn <n>/<max>    │
│> 08 now   agent work - work in progress  │
│. 09 next  measure progress - waiting...  │
│. 10 next  feedback - waiting...          │
╰──────────────────────────────────────────╯
```

The runtime step table is the live version of the core loop orchestration steps: `/loop status` prints all 12 steps, and the panel shows all 12 steps in its expanded layout. ACE launch status is shown separately in the `ace` data row and in `ace_run_*` log events because ACE runs daemon-style outside the LLM turn lifecycle. `done` is only for completed past steps; future steps render as `next`/waiting until the active step advances. The floating panel carries loop progress while Pi's footer remains reserved for Pi status. When the loop finishes, pi-loop clears the widget and sends a concise TL;DR message covering what was accomplished plus the steps taken in each loop turn.

### Sequential best-of-K runs

`--runs=K` starts bounded sequential attempts in the same Pi session. This is not a statistically independent restart like the paper's fresh best-of-K runs, but it gives pi-loop a safe best-of-K analogue without spawning agents, forking sessions, or running parallel edits.

Behavior:

1. Run 1 starts with the normalized target context.
2. If a run reaches its turn limit, pi-loop appends `run_stopped`, starts the next run, and asks for a genuinely different plan.
3. Scoring improvements are retained as best-so-far feedback but do not stop remaining runs.
4. If all runs exhaust, the stop reason reports the best progress and run.
5. `/loop off` stops all runs.

### Premature-stop handling

If a turn ends without `score_loop_result`, pi-loop appends a `missing_score` event and asks the agent to record evidence before doing more work. If the agent appears to claim completion before a configured stop point, pi-loop appends `premature_stop` and treats the completion claim as rejected, even if the latest score is a new best.

## Initial example

Start Pi in a repository, then run:

```text
/loop Improve the CartCalculator discount tests so they prove behavior without mocking owned code --minutes=10 --turns=8
```

Expected first turn:

1. The agent identifies the affected production and test files.
2. It maps acceptance criteria, for example:
   - discounts are applied for eligible carts
   - ineligible carts keep the original total
   - owned code is not mocked
   - the changed behavior is covered by observable assertions
3. It edits or adds tests.
4. It runs verification, for example:

```bash
pnpm test tests/cart-calculator.test.mjs
pnpm typecheck
```

5. It calls `score_loop_result` with evidence like this:

```json
{
  "summary": "Added behavior tests for eligible and ineligible cart discounts without mocking owned code.",
  "attempt": {
    "rationale": "The target behavior is discount eligibility, so the safest proof is observable behavior tests without owned-code stubs.",
    "fullPlan": "Inspect CartCalculator behavior, add eligible and ineligible tests, run targeted tests and typecheck, then score the result.",
    "actionsTaken": ["added behavior tests", "ran targeted tests", "ran typecheck"],
    "stopIntent": "claim_done"
  },
  "artifacts": [
    { "path": "src/cart-calculator.ts", "purpose": "discount behavior", "kind": "source" },
    { "path": "tests/cart-calculator.test.mjs", "purpose": "behavior coverage", "kind": "test" }
  ],
  "requirements": [
    { "description": "Eligible carts receive discounts", "status": "met" },
    { "description": "Ineligible carts keep original total", "status": "met" },
    { "description": "Owned code is not mocked", "status": "met" }
  ],
  "checks": [
    {
      "name": "targeted tests",
      "status": "passed",
      "kind": "test",
      "required": true,
      "scope": "targeted",
      "command": "pnpm test tests/cart-calculator.test.mjs",
      "exitCode": 0,
      "evidence": "all cart calculator tests passed"
    },
    {
      "name": "typecheck",
      "status": "passed",
      "kind": "typecheck",
      "required": true,
      "scope": "full",
      "command": "pnpm typecheck",
      "exitCode": 0,
      "evidence": "tsc completed without errors"
    }
  ],
  "tests": {
    "files": ["tests/cart-calculator.test.mjs"],
    "behaviorsCovered": ["eligible discount", "ineligible no-op"],
    "regressionCovered": true,
    "edgeCasesCovered": ["zero discount", "missing eligibility"],
    "failurePathsCovered": ["ineligible cart"],
    "observableAssertions": true,
    "changedCodeCovered": true,
    "usesMocksForOwnedCode": false,
    "mockOnly": false,
    "hasSleeps": false,
    "flaky": false,
    "implementationCoupled": false,
    "mockingEvidence": "tests use real CartCalculator behavior and no owned-code stubs"
  },
  "design": {
    "singleResponsibility": true,
    "noGodFiles": true,
    "boundariesClear": true,
    "lowCouplingHighCohesion": true,
    "complexityControlled": true
  },
  "rails": { "relevant": false },
  "operability": {
    "limitsDefined": true,
    "persistenceDefined": true,
    "loggingAvailable": true,
    "rollbackOrRecoveryDefined": true,
    "humanStopAvailable": true
  },
  "reviewGates": [
    {
      "name": "local required checks",
      "status": "passed",
      "kind": "ci",
      "required": true,
      "scope": "full",
      "command": "pnpm test && pnpm typecheck",
      "evidence": "all local required checks passed"
    }
  ],
  "risks": []
}
```

Possible first response:

```text
Progress: baseline recorded (baseline recorded; continue)
Outcome: needs_iteration
Blockers:
- important: Non-trivial executable change has no automated review gate evidence.
Next actions:
- Baseline recorded; run another loop turn and use feedback to explore a better attempt.
- Automated review gates: No security or dependency review gate evidence was provided.
```

The next turn starts from that feedback. The agent might run full CI-equivalent checks, add missing edge coverage, or resolve a blocker. The extension does not stop on heuristic satisfaction; it keeps exploring until the configured limits or a user stop.

## Internal measurement model

The evidence contract is exposed through `extensions/pi-loop/scoring-heuristics.ts`. Agents and external checker integrations should import that facade as the source of truth. The implementation is split by responsibility under `extensions/pi-loop/scoring/`.

Hard-cap rule files live under `extensions/pi-loop/scoring/rules/`. A custom integration can create a `RuleRegistry`, call `.load(customRule)`, and pass that registry to `scoreLoopResult(input, registry)`.

```ts
import { RuleRegistry, scoreLoopResult } from "./extensions/pi-loop/scoring-heuristics.ts";

const registry = new RuleRegistry()
  .load(myTeamRule)
  .load(mySecurityRule);

const result = scoreLoopResult(input, registry);
```

Default built-in rule families:

```text
requirements
attempt
verification
test-quality
review-gates
rails-safety
design-solid
operability
risks
contradictions
```

Internal category weights:

| Category | Points |
| --- | ---: |
| Correctness | 20 |
| Testing quality | 20 |
| Design and SOLID | 18 |
| Rails engineering | 15 |
| Verification and gates | 12 |
| Automated review gates | 10 |
| Operational hardening | 5 |

Hard caps lower the internal measurement when requirements are missing, attempt plans are missing, artifacts are absent or unverifiable, verification is missing, review gates are missing or failed, tests are mock-only, owned code is mocked, tests are implementation-coupled, mock status is unstated, Rails evidence contradicts touched paths, critical security/auth/data risks remain unresolved, or loop behavior is unbounded. The user-facing loop progress is still only percent improvement over the first scored attempt.

## Runtime diagram

```text
PHASE 1: CONTEXT INITIALIZATION

User
  |
  | /loop <goal> --minutes=N --turns=N --runs=N
  v
+-----------------------+
| /loop command parser  |
| parseLoopArgs()       |
+-----------------------+
  |
  | parsed goal + limits
  v
+-----------------------------+
| Context initializer         |
| buildTargetContextSnapshot()|
| files, symbols, checks, git |
+-----------------------------+
  |
  | context snapshot
  v
+-----------------------+
| Runtime state         |
| startLoopState()      |
+-----------------------+
  |
  +----------------------------+
  |                            |
  | config + context entry     | active scorer
  v                            v
+-----------------------+    +--------------------------+
| ~/.pi/agent/pi-loop/... |  | score_loop_result tool   |
| append config         |    | enabled for this session |
+-----------------------+    +--------------------------+
  |
  | kickoffPrompt(state)
  v
+--------------------------------------------------+
| Agent receives context                           |
| - goal                                           |
| - time/turn/run budget                           |
| - context snapshot                               |
| - evidence contract                              |
| - hard rules                                     |
| - instruction to analyze before implementation   |
+--------------------------------------------------+


PHASE 2: ITERATIVE OPTIMIZATION LOOP

+--------------------------------------------------+
| before_agent_start                               |
| inject systemPromptAddon(state)                  |
+--------------------------------------------------+
  |
  v
+--------------------------------------------------+
| Agent turn                                       |
| - inspect files                                  |
| - map requirements                               |
| - declare attempt rationale + full plan          |
| - edit / investigate                             |
| - run real checks                                |
| - collect evidence                               |
+--------------------------------------------------+
  |
  | structured evidence
  v
+--------------------------------------------------+
| score_loop_result                                |
| TypeBox validates strict input schema            |
+--------------------------------------------------+
  |
  v
+--------------------------------------------------+
| scoreLoopResult(input)                           |
| - independent evidence verifier                  |
| - internal category measurements                 |
| - plug/play rule files                           |
| - hard caps                                      |
| - blockers                                      |
| - typed outcome                                  |
| - verifier findings                             |
| - next actions                                  |
| - progress vs first scored baseline              |
+--------------------------------------------------+
  |
  +----------------------------+-------------------+
  |                            |
  | progress entry             | visible feedback
  v                            v
+-----------------------+    +--------------------------+
| ~/.pi/agent/pi-loop/... |  | Floating side panel     |
| append progress/outcome|   | data / prompt / history |
+-----------------------+    +--------------------------+
  |
  v
+--------------------------------------------------+
| Stop check                                       |
| - timebox reached                                |
| - current run turn limit reached                 |
| - all runs exhausted                             |
| - user ran /loop off                             |
| - repeated missing score calls                   |
+--------------------------------------------------+
  |
  +-------------+----------------------+----------------+
  | finish      | next run available   | continue same run
  v             v                      v
+-------------+ +--------------------+ +------------------------------+
| finishLoop  | | run_stopped event  | | continuePrompt(state)        |
| stop event  | | run_started event  | | compact feedback history     |
+-------------+ | nextRunPrompt      | | blockers + next actions      |
                +--------------------+ +------------------------------+
                         |                         |
                         v                         v
                    next agent turn           next agent turn


PLUG/PLAY RULE LOADER

scoreLoopResult(input, registry?)
  |
  v
+--------------------------+
| RuleRegistry             |
| .load(rule)              |
| .evaluate(input)         |
+--------------------------+
  |
  +--> requirements.ts
  +--> attempt.ts
  +--> verification.ts
  +--> test-quality.ts
  +--> review-gates.ts
  +--> rails-safety.ts
  +--> design-solid.ts
  +--> operability.ts
  +--> risks.ts
  +--> contradictions.ts
  |
  v
hard caps + blocker reasons


SESSION RESTORE

Pi session_start
  |
  v
+--------------------------+
| reconstructLoopState()   |
| read ~/.pi/agent/pi-loop |
| replay config + scores   |
+--------------------------+
  |
  +--> if active and limits not reached: restore widget + scorer
  +--> otherwise: stay stopped
```

## Repository layout

```text
extensions/pi-loop/index.ts                  extension entrypoint
extensions/pi-loop/target-context.ts         normalized target context snapshot
extensions/pi-loop/feedback-history.ts       compact score-history feedback
extensions/pi-loop/premature-stop.ts         completion-claim detection
extensions/pi-loop/run-manager.ts            sequential best-of-K run helpers
extensions/pi-loop/controller.ts             loop lifecycle orchestration
extensions/pi-loop/events.ts                 Pi lifecycle event handlers
extensions/pi-loop/loop-command.ts           /loop command registration
extensions/pi-loop/score-tool.ts             score_loop_result registration
extensions/pi-loop/tool-schema.ts            strict tool input schema
extensions/pi-loop/state.ts                  runtime state transitions
extensions/pi-loop/log.ts                    ~/.pi/agent/pi-loop/projects persistence
extensions/pi-loop/ui.ts                     floating right-side progress panel
extensions/pi-loop/scoring-heuristics.ts     public scoring facade
extensions/pi-loop/scoring/evidence-verifier.ts independent evidence checks
extensions/pi-loop/scoring/outcome.ts        typed paper-style feedback outcomes
extensions/pi-loop/scoring/rules/            plug/play hard-cap rule files
tests/                                       behavior and scoring tests
```

Source and test modules are kept under roughly 200 lines to avoid god files.

## Development

```bash
pnpm install
pnpm check
pnpm smoke
```

Individual commands:

```bash
pnpm test
pnpm typecheck
pi --mode json --no-session --no-extensions -e ./extensions/pi-loop/index.ts -p '/loop status'
```

## Runtime files

`pi-loop` writes runtime state only under Pi's global agent directory:

```text
~/.pi/agent/pi-loop/projects/<project>/log.jsonl
```

Delete the global log manually or run `/loop clear` to remove loop state.
