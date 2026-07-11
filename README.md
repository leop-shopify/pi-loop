# pi-loop

`pi-loop` is one Pi package for three work modes:

| Mode | Driver | Command |
| --- | --- | --- |
| Goal | Bounded intelligent iteration and evidence feedback | `/goal <objective>` |
| Loop | Time | `/loop <interval> <prompt>` |
| Plan | Read-only exploration and milestones | `/plan <request>` |

The modes share one runtime and arbitrate ownership internally. A scheduled run cannot start while Goal or Plan is active, and Goal or Plan cannot start while a scheduled run is executing.

## Install

```bash
pi install /absolute/path/to/pi-loop
```

For a project-local install:

```bash
pi install -l /absolute/path/to/pi-loop
```

## Intelligent Goals

Goal mode preserves the original score-guided pi-loop engine and floating progress panel.

```text
/goal Improve source.ts
/goal Improve source.ts --minutes=10 --turns=12 --target=90 --runs=1
/goal Improve source.ts --file=src/source.ts --symbol=Source --check="pnpm test"
/goal status
/goal stop
/goal off
/goal clear
/pi-goal hide
/pi-goal show
/pi-goal toggle
```

`Ctrl+Alt+L` toggles the floating panel. `stop` and `off` are management commands and never become new objectives.

The default bounds are ten active-agent minutes, twelve normal work turns, and one run. Up to five sequential runs are supported, but `runs * turns` cannot exceed twelve.

### How Goal mode works

1. Captures target files, symbols, checks, package scripts, numeric objectives, and prior attempts.
2. Opens the non-capturing right-side floating panel.
3. Starts with acceptance discovery when the expected outcome is not yet confirmed.
4. Exposes `loop_feedback` while the Goal is active.
5. Treats the first scored attempt as a baseline rather than completion.
6. Independently verifies artifacts and command evidence before scoring.
7. Applies correctness, testing, design, Rails safety, operability, review-gate, requirements, and risk caps.
8. Carries progress trends, blockers, evidence gaps, prior plans, numeric measurements, and next actions into the next prompt.
9. Detects plateaus, repeated plans, missing feedback, premature completion claims, and unfinished delegated research.
10. Runs falsification-oriented confirmation passes after a structured completion claim.
11. Retains Goal ownership and turn accounting through Pi provider retries and overflow recovery.
12. Stops only when the configured limits are reached, the user stops it, or repeated missing feedback makes safe continuation impossible.

A score is refinement feedback, not an acceptance oracle. Reaching the configured target score does not end the Goal by itself.

Pi 0.80.2 does not expose its `willRetry` decision to extension `agent_end` handlers. pi-loop therefore retains retry-candidate ownership behind a 15-second terminal fallback; the next retry `agent_start` cancels that fallback without consuming another Goal turn.

### Floating panel

The original floating panel remains part of Goal mode. It shows:

- Goal and active state
- run and turn budgets
- elapsed and recent turn time
- context usage
- latest and best progress
- current prompt
- persisted step history

The panel is right-centered, non-capturing, 25% wide, at least 36 columns, and hidden automatically on narrow terminals.

### Goal feedback and confirmation

`loop_feedback` records focused attempt evidence, acceptance status, criteria, plan tasks, measured metrics, hypothesis, verdict, blockers, and next actions. Heavy implementation or verification work belongs in normal tools; the feedback tool records the checkpoint.

A completion claim requires confirmed acceptance criteria and completed plan tasks. Later turns try to falsify that claim from different angles and can reopen normal iteration when evidence fails.

## Scheduled Loops

Create recurring, session-scoped tasks with an explicit interval:

```text
/loop 5m check whether CI passed and summarize any failures
/loop 2h review new pull-request comments
/loop 1d summarize commits from the last day
```

Manage tasks:

```text
/loop status
/loop pause <id>
/loop resume <id>
/loop run <id>
/loop cancel <id>
/loop clear
/loop help
```

`/pi-loop` is an alias for scheduled `/loop` commands. Intervals support minutes, hours, and days. The minimum is one minute and the maximum is six days, so every task can run before its seven-day expiry.

Each scheduled task:

- belongs to the current Pi session and conversation branch
- expires seven days after creation
- fires only while Pi is running
- runs between agent turns
- never overlaps another scheduled run
- retains running ownership through provider retries and task expiry
- waits while Goal or Plan owns autonomy
- coalesces missed intervals into one pending run
- restores and re-arms when the session starts or the conversation branch changes
- records up to 20 completed, failed, or cancelled runs
- sends one bounded prompt per run and then stops

A late task does not replay every missed interval. It runs once and schedules the next future occurrence.

## Planning

Start read-only exploration with:

```text
/plan <request>
/plan status
/plan clear
```

Plan mode activates an explicit read-only tool allowlist and removes Bash, edit, write, Goal feedback, and unknown custom tools. The agent calls `save_plan` with a self-contained living plan containing:

- context and orientation
- constraints and boundaries
- acceptance criteria
- independently verifiable milestones
- steps and verification commands per milestone
- risks and decisions

When the plan is ready, choose:

- Turn plan into a Goal
- Execute once
- Refine plan
- Keep plan

Turning a Plan into a Goal starts the intelligent engine with the Plan outcome, verification, constraints, boundaries, acceptance criteria, milestones, iteration policy, and blocked stop condition embedded in the objective.

## Rich-prompt advisor

For an interactive, multi-part prompt without an explicit mode instruction, pi-loop may offer to draft a Goal contract, Plan first, continue normally, or stop asking for the session.

The advisor uses deterministic prompt-shape signals. It skips extension messages, steering and queued follow-ups, slash commands, shell input, explicit Goal/Plan/Loop or scheduling requests, short prompts, no-UI sessions, and sessions where a work mode is already active.

## Tools

- `create_goal`: starts the intelligent Goal engine only when Goal mode was explicitly requested
- `get_goal`: returns a non-circular Goal and progress summary
- `loop_feedback`: records score-guided evidence and attempt feedback while Goal mode is active
- `get_plan`: reads the saved structured Plan
- `save_plan`: saves the result of read-only Plan exploration

## Persistence

Intelligent Goal history uses the original project-keyed JSONL log under:

```text
~/.pi/agent/pi-loop/projects/<project-key>/log.jsonl
```

Entries retain the original config, score, event, session, run, turn, evidence, and step-history contracts. Scheduled task state uses Pi custom session entries with `customType: "pi-loop-schedule"`. Plan state uses `customType: "pi-plan"`.

There is no background daemon. Scheduled work that must run while Pi or the computer is closed requires an external scheduler or durable automation service.

## Migration

### 1.0.0

The `pi-ace-adapter` integration has been removed. pi-loop no longer reads adapter storage or starts the adapter. Existing `.pi/ace` files and historical `ace_run_*` log entries are ignored; pi-loop does not delete them.

Older pi-loop releases used `/loop <goal>`. Goal text without an interval is no longer silently interpreted as a schedule:

```text
/loop Improve the test suite until coverage reaches 90%
```

returns guidance to use:

```text
/goal Improve the test suite until coverage reaches 90%
```

The intelligent engine, floating panel, scoring, confirmation, history, and bounded iteration behavior are preserved under `/goal`.

## Architecture

```text
extensions/pi-loop/index.ts                     unified lifecycle and work arbitration
extensions/pi-loop/intelligent-goal.ts          intelligent Goal registration and model tools
extensions/pi-loop/loop-command.ts               Goal command and floating-panel controls
extensions/pi-loop/controller.ts                 Goal continuation, limits, and completion summary
extensions/pi-loop/events.ts                     Goal lifecycle and refined continuation
extensions/pi-loop/score-tool.ts                 Goal feedback and evidence collection
extensions/pi-loop/scoring/                      scoring categories, verification, and hard caps
extensions/pi-loop/prompt.ts                     acceptance, refinement, and confirmation prompts
extensions/pi-loop/state.ts                      Goal runs, attempts, timing, and progress state
extensions/pi-loop/floating-panel.ts             generic overlay implementation
extensions/pi-loop/ui.ts                         intelligent Goal panel rendering
extensions/pi-loop/schedule-*.ts                 scheduled task parsing and state
extensions/pi-loop/scheduler.ts                  timers, persistence, and coalescing
extensions/pi-loop/plan/                         Plan state, safety, advisor, and runtime
```

## Development

```bash
pnpm check
pnpm smoke
pnpm pack:dry
```

## Design sources

- [Codex: Follow a goal](https://developers.openai.com/codex/use-cases/follow-goals)
- [Codex: Using PLANS.md for multi-hour problem solving](https://developers.openai.com/cookbook/articles/codex_exec_plans)
- [Codex automations](https://developers.openai.com/codex/app/automations)
- [Claude Code goals](https://code.claude.com/docs/en/goal)
- [Claude Code best practices](https://code.claude.com/docs/en/best-practices)
- [Claude Code scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks)

## License

MIT
