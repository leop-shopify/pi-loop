# Pi-loop General Engineering Playbook

Use this playbook to guide pi-loop attempts for general software engineering work. It is intentionally not tied to benchmarks or a single project domain.

## Operating loop

1. Restate the goal as externally observable behavior, not as internal implementation intent.
2. Identify the smallest verifiable slice that can improve the current state within the loop timebox.
3. Inspect the relevant source, tests, docs, and package scripts before editing.
4. Make one focused change. Avoid unrelated cleanup, broad rewrites, or speculative abstractions.
5. Run the narrowest meaningful check first, then one broader gate when shared behavior or packaging changed.
6. Call `score_loop_result` with concrete evidence: requirements, changed artifacts, commands, review gates, risks, and next actions.
7. Treat baseline/new-best scores as feedback only. Continue until the configured loop limit or user stop condition.

## Strategy by task type

- **Bug fix**: reproduce or narrow the symptom, patch the producer of invalid state, and add regression coverage that would fail on the bug.
- **Test hardening**: prefer behavior assertions over implementation details. Do not mock owned code unless the seam is explicitly external.
- **Refactor**: preserve behavior, keep names and boundaries clearer, and run the same behavior checks before/after when feasible.
- **Docs/config/package work**: verify install/load/runtime paths, not just prose. Include manifest or smoke evidence when packaging changes.
- **ACE integration work**: keep `/ace` command registration, prompt context, daemon launch, logs, and promotion as separate responsibilities.

## Evidence checklist

A strong scored attempt includes:

- Requirement status with direct evidence.
- Artifact paths and why each changed.
- Passed checks with command, exit code, scope, and observed output.
- Automated gate evidence for executable changes, or an explicit reason when only local checks exist.
- Operability notes for logs, metadata, paths, daemon/background processes, and recovery.
- Risks and unfinished work carried into the next attempt instead of hidden.

## Anti-patterns

- Repeating the same plan after scorer feedback without a new hypothesis.
- Claiming done after the first baseline score.
- Single-domain assumptions or task-specific evaluation commands for unrelated work.
- Long-running foreground ACE jobs that block pi-loop orchestration.
- Auto-promoting an ACE candidate without explicit review.
