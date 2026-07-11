# Remove pi-ace-adapter from pi-loop

This implementation plan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds. A fresh Sol session must be able to execute the work from this file and the current repository alone.

## Sol session instruction

From `/Users/leonardopereira/Poetry/pi-loop`, ask Sol to read this file completely, verify the recorded baseline before editing, and execute the milestones in order. The desired architecture is a hard removal: pi-loop must not retain, rename, replace, or reimplement the ACE adapter subsystem. Do not edit `/Users/leonardopereira/Poetry/pi-ace-adapter` or local legacy `.pi/ace` data.

## Purpose / Big Picture

pi-loop still contains runtime, prompt, state, log, UI, test, documentation, and packaged-asset coupling to `pi-ace-adapter`, even though the manifest dependency was previously removed. The user no longer wants the adapter. After this change, pi-loop will operate entirely through its native Goal, Loop, Plan, scoring, feedback, acceptance, confirmation, and delegation behavior. It will never resolve the adapter package, read adapter storage, emit adapter events, start its daemon, inject ACE text, or ship ACE assets.

The user-visible proof is that `/goal` kickoff and every continuation behave normally with native scoring and prior-feedback strategy selection, the panel contains no ACE row, packages contain no ACE resources, and legacy ACE state can remain on disk without being read or destroyed. The extension will be released as `1.0.0`, reviewed when required, and committed only after explicit user approval.

## Progress

- [x] Reconfirm repository state, package-manager version, stale local adapter resolution, and current dry-package contents.
- [x] Relocate the adapter-neutral spawn-only delegation regression.
- [x] Remove ACE runtime imports, context injection, daemon launch, and prompt coupling.
- [x] Remove ACE runtime state, log reconstruction, events, constants, and UI.
- [x] Delete ACE modules, tests, and packaged assets.
- [x] Update documentation, package boundaries, and migration notes.
- [x] Bump pi-loop to `1.0.0`.
- [x] Run focused, full, smoke, package, and negative-scan verification.
- [x] Complete the approval-gated independent review.
- [x] Obtain explicit user approval, then create the scoped commit.

## Surprises & Discoveries

Record new evidence here without erasing prior entries.

- Observation: the package manifest and lockfile no longer declare `pi-ace-adapter`, but source still dynamically imports it and directly reads its storage format.
  Evidence: `extensions/pi-loop/ace-context.ts` contains both the dynamic package import and fallback `.pi/ace` reads.
- Observation: a stale `node_modules/pi-ace-adapter` symlink can make accidental imports work locally despite the clean manifest.
  Evidence: the planning baseline contained the stale linked install artifact.
- Observation: the daemon listener/runner expected by pi-loop exists only in the dirty adapter working tree, not adapter HEAD.
  Evidence: adapter `src/index.ts` and `src/runner.ts` changes were uncommitted at planning time.
- Observation: one non-ACE spawn-only delegation regression lives in `tests/ace-context.test.mjs` and would be lost by deleting the file.
  Evidence: the adapter-neutral test occupies the block around lines 113–142.
- Observation: the shell resolved plain `pnpm` to `11.5.2`, not the repository-declared `10.28.0`; the user authorized exact-version Corepack invocation rather than a global activation or version waiver.
  Evidence: `pnpm --version` returned `11.5.2`, while `corepack pnpm@10.28.0 --version` returned `10.28.0`.
- Observation: the recorded commit/upstream baseline still matches, but the living plan itself makes the worktree intentionally non-clean under untracked `docs/plans/`.
  Evidence: `main`, `HEAD` and `origin/main` are all at `8ee997326e0de91db563008ae701eb176d217e61`; `git status --short --branch` reports only `?? docs/plans/`.
- Observation: the stale adapter install and ACE package contents are both present before removal.
  Evidence: `node_modules/pi-ace-adapter` is a symlink into a file-linked `.pnpm` entry, and `corepack pnpm@10.28.0 pack --dry-run --json` lists `ace/` resources plus `extensions/pi-loop/ace-context.ts` and `ace-launch.ts`.
- Observation: the adapter-neutral spawn-only regression passes from Goal lifecycle coverage before removal of its old ACE test host.
  Evidence: `corepack pnpm@10.28.0 exec node --experimental-strip-types --test --test-name-pattern='spawn-only turns wait for agent reports instead of forcing a missing-score prompt' tests/goal-process-e2e.test.mjs` passed 1/1.
- Observation: the permissive parser accepts historical event strings even after removing them from the current TypeScript event union.
  Evidence: the new restore regression appends all four legacy run-event variants and asserts an active restored Goal with no adapter state property.
- Observation: hostile independence can be tested without touching the real home or stale repository install.
  Evidence: the Goal lifecycle regression creates temp legacy storage plus a temp resolvable package, and combines source guards with event, timer, process, import-marker, log, and prompt sentinels.
- Observation: the initial complete `check` failure was caused by a pre-existing incomplete install rather than this removal.
  Evidence: 186 tests passed while three CJS Plan/advisor files failed at startup with `Cannot find module 'jiti'`; `jiti@2.7.0` was already declared, locked, and present in the virtual store, and a diagnostic resolution override made those files pass 9/9.
- Observation: the user-approved frozen offline install repaired the missing `jiti` link and pruned the stale undeclared adapter link without changing tracked dependency metadata.
  Evidence: `corepack pnpm@10.28.0 install --offline --frozen-lockfile` reported `+ jiti 2.7.0` and `- pi-ace-adapter 0.1.0`; `node_modules/jiti` now resolves, `node_modules/pi-ace-adapter` is absent, and the complete check passes 195/195.
- Observation: the hostile regression's fake adapter is resolvable from its temp Goal cwd but not from the extension module's former ESM import location.
  Evidence: the independent reviewer confirmed that legacy-storage, source, event, timer, process, log, and prompt tripwires are meaningful, while the temp `createRequire` probe overstates the dynamic-import portion. This is non-blocking because module deletion, runtime scans, behavior tests, and package inspection independently prove no resolver remains.

## Decision Log

- Decision: remove all ACE/adapter behavior with no replacement integration, feature flag, native playbook clone, compatibility reader, daemon bridge, or bundled ACE resources.
  Rationale: the user explicitly does not want the adapter anymore; renaming its concepts would retain unwanted architecture.
  Date/Author: 2026-07-10 / user decision.
- Decision: preserve pi-loop-native strategy selection based on prior feedback and scoring.
  Rationale: small verifiable slices and materially different retry strategies are native loop quality requirements, not adapter ownership.
  Date/Author: 2026-07-10 / planning session.
- Decision: leave legacy `.pi/ace` data untouched and ignore old `ace_run_*` log events through the permissive event parser.
  Rationale: hard runtime removal does not require destructive user-data cleanup, and old logs should remain readable.
  Date/Author: 2026-07-10 / planning session.
- Decision: release as `1.0.0`.
  Rationale: prompt enrichment, daemon launch, state/log events, UI, and packaged assets are intentionally removed; the user requested a major version.
  Date/Author: 2026-07-10 / user requirement.
- Decision: invoke pnpm as `corepack pnpm@10.28.0` for this execution without globally activating it.
  Rationale: the shell resolves pnpm `11.5.2`, the repository requires `10.28.0`, and the user explicitly approved Corepack downloading/caching and invoking the exact declared version.
  Date/Author: 2026-07-10 / user approval.
- Decision: host the spawn-only delegation regression in `tests/goal-process-e2e.test.mjs`.
  Rationale: it exercises the Goal agent-end lifecycle and delegation behavior, not adapter context.
  Date/Author: 2026-07-10 / implementation session.
- Decision: restore the existing locked dependencies with an offline frozen pnpm install after independent verification confirmed the `jiti` resolution blocker.
  Rationale: this was the smallest legitimate way to make the complete gate reproducible without editing dependency metadata or hand-creating a symlink; the user explicitly approved the package operation and accepted normal `node_modules` reconciliation.
  Date/Author: 2026-07-10 / user approval.
- Decision: create the single scoped 1.0.0 removal commit after the approve-with-suggestions review.
  Rationale: all verification is green, the review has no blockers, and the user explicitly approved committing the reviewed diff while retaining the hostile-test coverage caveat as non-blocking context.
  Date/Author: 2026-07-10 / user approval.

## Context and Orientation

At planning time `pi-loop` was clean on `main` at `8ee9973`, matching `origin/main`, with package version `0.3.2`. There were no release tags, changelog, release workflow, or publishing script. Reconfirm this state before editing.

The ACE coupling flows through these areas:

- `extensions/pi-loop/loop-command.ts` builds ACE context, launches ACE, injects context into Goal kickoff, and clears ACE runtime state.
- `extensions/pi-loop/ace-context.ts` dynamically imports `pi-ace-adapter/context`, reads local/global adapter storage, and duplicates formatting/truncation behavior.
- `extensions/pi-loop/ace-launch.ts` emits `pi-ace-adapter:launch-daemon`, waits for a response window, and records launch status.
- `extensions/pi-loop/events.ts` re-reads ACE context for continuation, next-run, acceptance, and other paths.
- `extensions/pi-loop/prompt.ts` accepts ACE options, injects ACE blocks, and contains two strategy sentences that currently attribute decision-making to ACE.
- `extensions/pi-loop/state.ts`, `log.ts`, `ui.ts`, and `constants.ts` define and render ACE-specific runtime state, events, replay, and limits.
- `ace/` contains tracked playbook, dataset, and proof assets included in the package.
- `tests/ace-context.test.mjs`, `tests/package-boundary.test.mjs`, `tests/prompt.test.mjs`, and `tests/confirmation-pass.test.mjs` encode the current adapter contract.
- `README.md` and `docs/research-perfect-loop-2026-07.md` describe ACE as part of the current product.

Commit `b8c6f8b` removed the direct manifest dependency and lockfile records but deliberately left the runtime bridge and assets. This plan finishes that removal.

The sibling `/Users/leonardopereira/Poetry/pi-ace-adapter` repository is outside the edit boundary. It was dirty at planning time. Do not use it as an implementation dependency, clean it, fix it, version it, archive it, or commit it. The user asked to remove it from pi-loop, not to modify or delete the sibling repository.

## Constraints and Non-Goals

Use pnpm only. The repository declares pnpm `10.28.0`. Start by checking the resolved pnpm version. If the environment resolves an incompatible version, stop and ask the user rather than installing or bypassing the declared package manager.

Do not manually delete or modify ignored `.pi/ace` state. Do not manually clean stale `node_modules`; verify source and package independence through negative scans and the dry package. Any future install/cleanup is a separate approved package operation.

Do not create a generic playbook subsystem, ACE compatibility flag, adapter migration layer, or replacement daemon. Do not weaken native scoring, prior-feedback strategy, plateau detection, bounded delegation, confirmation, or acceptance behavior. Do not change the event-log schema solely to remove fields that the permissive parser can already ignore.

Do not push, tag, publish, or create a GitHub release without separate explicit approval. A commit is also forbidden until implementation, verification, review, and explicit commit approval are complete.

## Observable Acceptance Criteria

The tracked working tree and shipped package must contain no runtime or documentation dependency on `pi-ace-adapter`, `PI_ACE_ADAPTER_DAEMON_DRY_RUN`, `.pi/ace` readers, `ace_run_*`, `ACE_LOOP_CONTEXT_CHAR_CAP`, ACE UI labels, ACE prompt blocks, or tracked `ace/` resources. Immutable git history is excluded from this criterion.

Starting `/goal` and advancing every continuation path must not import another package, resolve adapter files, read adapter storage, emit an adapter event, wait on the old one-second launch timeout, start `uv`, or inject ACE text—even when legacy `.pi/ace` exists and stale `node_modules` still resolves the adapter.

Native prompts must still direct the loop to use prior feedback and feedback-scoring output to choose a materially different verifiable slice after failure or plateau.

New runtime state, panel output, and newly written event logs must have no ACE surface. Legacy JSONL containing `ace_run_*` must remain loadable; those entries are ignored as unknown events. Legacy `.pi/ace` data remains untouched and inert.

`pnpm pack --dry-run --json` must show no `ace/` directory, adapter modules, or adapter resource path. The package must still contain all native extension, skill, and documentation files required at runtime.

The sibling adapter repository must show no changes caused by this work.

The package version and package-boundary assertion must be `1.0.0`, and README must explain that the adapter integration was removed and legacy ACE data is not deleted.

Focused tests, the complete test suite, typecheck, Pi smoke, dry pack, diff check, and targeted negative scans must pass.

## Plan of Work

### Milestone 1: Preserve the adapter-neutral regression before deletion

Before deleting `tests/ace-context.test.mjs`, move the spawn-only delegation regression around its current lines 113–142 into an adapter-neutral lifecycle or events test file. Preserve its behavior and naming so future readers understand that it verifies delegation, not ACE.

Run the relocated test by itself and prove it passes before removing the source file. This avoids hiding a regression behind a large deletion.

Milestone proof: the test exists in a semantically correct file, passes independently, and no duplicate remains in the ACE test file.

### Milestone 2: Excise runtime context and daemon launch

Delete `extensions/pi-loop/ace-context.ts` and `extensions/pi-loop/ace-launch.ts` after removing all imports and call sites.

In `extensions/pi-loop/loop-command.ts`, remove ACE imports, context construction, daemon launch, kickoff options, and ACE state clearing. Goal kickoff should call native prompt builders directly.

In `extensions/pi-loop/events.ts`, remove the ACE import and every asynchronous context load. Simplify continuation, next-run, acceptance, confirmation, and premature-stop branches to invoke native prompt builders without adapter options.

In `extensions/pi-loop/prompt.ts`, remove `LoopPromptOptions`, `promptAceContext`, all adapter-context parameters, and every injection point. Rewrite the strategy guidance so it remains native:

- kickoff guidance should use prior feedback and feedback-scoring output to choose the next strategy;
- continuation guidance should use prior feedback to select a genuinely different verifiable slice.

Do not remove or weaken the requirement to change strategy after failed or plateauing attempts.

Milestone proof: focused prompt and Goal lifecycle tests pass; a targeted source scan finds no runtime import, storage reader, launch event, timeout, or ACE prompt helper.

### Milestone 3: Remove state, persistence, events, and UI

In `extensions/pi-loop/state.ts`, remove `LoopAceRunState`, the runtime `aceRun` field and default, and ACE event union members.

In `extensions/pi-loop/log.ts`, remove ACE reconstruction and helper branches. Preserve permissive event parsing so historical unknown events remain harmless. Add a regression fixture containing old `ace_run_*` entries and prove restore continues without throwing or constructing ACE state.

In `extensions/pi-loop/ui.ts`, remove the ACE row and rendering helper. Check panel-height and layout tests because removing a row may change height calculations.

In `extensions/pi-loop/constants.ts`, remove `ACE_LOOP_CONTEXT_CHAR_CAP`.

Milestone proof: state/log/UI tests pass, restored legacy logs are readable, the panel has no ACE row, and new events contain no ACE type.

### Milestone 4: Delete packaged assets and rewrite tests/docs

Delete the tracked `ace/` directory and, once the adapter-neutral regression is relocated, delete `tests/ace-context.test.mjs`.

Update `package.json` to remove `ace` from the `files` list. No dependency or lockfile removal should be necessary because the manifest and lockfile already omit the adapter. Do not touch the lockfile unless current repository evidence contradicts that fact.

Update `tests/package-boundary.test.mjs` to assert the absence of the adapter dependency, ACE package entry, and ACE resources. Update its version assertion to `1.0.0` only in the release milestone.

Update `tests/prompt.test.mjs` for native strategy wording and remove context-injection expectations. Keep confirmation isolation coverage in `tests/confirmation-pass.test.mjs`, but make the assertion adapter-neutral—for example, prove confirmation does not include normal strategy guidance rather than searching for an ACE phrase.

Update `README.md` to remove ACE capture, state, daemon, and integration claims. Add a `1.0.0` migration note: pi-loop no longer reads or starts `pi-ace-adapter`; old `.pi/ace` files and old ACE log entries are ignored and are not deleted.

In `docs/research-perfect-loop-2026-07.md`, remove ACE from statements describing current differentiators. Preserve genuinely historical discussion unless it falsely describes current behavior.

Milestone proof: documentation and package boundary agree; the dry package contains no ACE assets or source; the sibling adapter and ignored local data are unchanged.

### Milestone 5: Add a negative end-to-end regression

Create a focused regression that prepares a temporary working directory containing legacy `.pi/ace` data, makes an adapter package resolvable or stubs resolution observably, starts a Goal, and proves that pi-loop performs no adapter read, event emission, process launch, timeout wait, or prompt injection.

The test must not mutate the real user home or sibling repository. It should fail on the pre-removal architecture and pass after removal. Avoid sleep-based assertions; use spies/fakes and deterministic lifecycle events.

Milestone proof: the regression demonstrates independence even in the hostile local condition that previously masked the missing manifest dependency.

### Milestone 6: Create the `1.0.0` release state

Set `package.json` version to `1.0.0` and update the hard-coded version assertion in `tests/package-boundary.test.mjs`. Document the breaking removal in README. Do not invent an npm publication, tag history, or changelog convention that the repository does not have.

If adding a changelog is desirable, ask the user first; it is not required for this removal because no changelog currently exists.

Milestone proof: package metadata, tests, and README consistently identify `1.0.0` and its removal behavior.

### Milestone 7: Verify, review, and commit only after approval

Run narrow tests first, then the complete project checks. Repair failures before continuing. Inspect the dry package and targeted scans manually rather than relying only on test success.

After the implementation is fully green and reviewable, ask whether to use `leo-the-reviewer`, with the required 30-second timeout. If the user says yes or does not answer, spawn a distinct read-only reviewer and wait for its final verdict. Do nothing else while the required review is running. Resolve material findings and re-review significant corrections.

Surface the reviewer verdict and verification evidence. Ask for explicit approval to commit. Only after approval, stage the pi-loop removal paths and create one coherent `1.0.0` removal commit.

Do not stage or modify the sibling adapter. Push, tag, PR, GitHub release, or publication requires separate explicit approval.

## Concrete Verification

Run from `/Users/leonardopereira/Poetry/pi-loop`:

    git status --short --branch
    pnpm --version
    pnpm exec vitest run tests/prompt.test.mjs tests/confirmation-pass.test.mjs tests/package-boundary.test.mjs
    pnpm check
    pnpm smoke
    pnpm pack:dry
    git diff --check

Run the complete repository test command documented by the current `package.json`; if `pnpm check` is the complete gate, record that fact rather than inventing a duplicate command.

Use a targeted negative scan that avoids false matches such as `interface`:

    rg -n 'pi-ace-adapter|PI_ACE_ADAPTER_DAEMON_DRY_RUN|ace_run_|ACE_LOOP_CONTEXT_CHAR_CAP|buildAceLoopContext|launchAceForLoop' extensions tests README.md docs package.json

Inspect package output and require zero ACE/adapter paths. Inspect repository status in both repositories:

    git -C /Users/leonardopereira/Poetry/pi-loop status --short
    git -C /Users/leonardopereira/Poetry/pi-ace-adapter status --short

Record the adapter status before implementation and prove it is byte-for-byte the same afterward. Do not attempt to clean it.

## Idempotence and Recovery

Runtime deletion should be performed in verifiable slices: prompt/runtime first, state/UI second, assets/docs third. Keep tests green after each milestone. If a milestone fails, revert only that milestone's scoped changes rather than restoring the entire dirty workspace.

Legacy data is intentionally non-destructive. Re-running the new version does not migrate, rewrite, or delete `.pi/ace`. Replaying old logs remains safe because unknown events are ignored.

Before commit, rollback uses `git restore` only on scoped pi-loop tracked files; do not run `git clean`, which could destroy unrelated untracked work. After an approved commit, rollback uses a normal revert commit. A source revert cannot guarantee operational adapter recovery because the compatible listener/runner was uncommitted in the sibling repository; do not promise that reverting pi-loop alone restores ACE.

## Interfaces and Dependencies

The final pi-loop runtime has no ACE interface. Prompt builders should expose only native inputs already owned by pi-loop. No source file may import, dynamically import, resolve, or reference an adapter path.

The permissive log parser remains the only compatibility boundary: unknown historical event types are tolerated but never reconstructed into current runtime state.

No new external dependency is allowed.

## Outcomes & Retrospective

Milestones 1–6 are implemented. Removed paths are `extensions/pi-loop/ace-context.ts`, `extensions/pi-loop/ace-launch.ts`, `tests/ace-context.test.mjs`, and tracked `ace/`. Goal kickoff and continuations now use native prompt builders; prior feedback and feedback-scoring guidance still requires a genuinely different verifiable slice after failure or plateau. Current state/log/UI no longer models adapter runs, while permissive parsing leaves historical run events inert. README documents the 1.0.0 migration and non-destructive handling of old local data.

Verification is green: the relocated regression passed independently (1/1); the hostile negative regression passed independently (1/1); affected focused tests passed (59/59); after the approved frozen offline dependency restoration, `corepack pnpm@10.28.0 check` passed all 195 tests and TypeScript validation; `smoke`, `pack:dry`, and `git diff --check` passed; runtime/package negative scans returned zero matches; and the 1.0.0 dry package contains the native extension tree and skills with no adapter modules or `ace/` resources. README migration text, package-absence assertions, the legacy-event fixture, and this living plan are the only remaining historical references. The sibling adapter status remains the same listed dirty baseline.

The approval-gated independent review verdict is **approve with suggestions** with no blocker. It verified the runtime/package removal, native iteration behavior, inert historical events, documentation, and metadata. Its sole suggestion is that the hostile test's temp `createRequire` probe overstates old ESM dynamic-import coverage; the test still proves temp legacy-storage independence and multiple runtime tripwires, while deletion, runtime scans, focused tests, and dry-package inspection independently close the resolver risk. The user explicitly approved the single scoped 1.0.0 removal commit. The exact commit identifier is reported by the completing session after Git creates the commit, since a commit cannot contain its own final hash. No push, tag, publication, GitHub release, or deployment is approved.
