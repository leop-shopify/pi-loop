---
name: pi-plan-writer
description: Draft or review self-contained implementation plans for pi-loop Plan mode. Use when the user asks to plan complex work, prepare milestones before coding, turn a rich prompt into a plan, or review whether a plan is executable and verifiable.
---

# Pi Plan Writer

A strong plan is a living implementation document, not a speculative checklist. It must let a fresh agent or engineer understand the problem, execute each milestone, verify the result, recover from failure, and explain why the chosen approach is safe.

## Required structure

1. State the user-visible outcome and why it matters.
2. Orient the reader to the relevant repository paths, systems, and terminology.
3. Record constraints, boundaries, and explicit non-goals.
4. Define observable acceptance criteria before implementation steps.
5. Split work into independently verifiable milestones.
6. Give each milestone a concrete outcome, ordered steps, and exact verification surface.
7. Record material risks, unknowns, and recovery paths.
8. Record decisions and their rationale as they are made.
9. Keep progress current so the plan can survive session continuation or compaction.

## Planning policy

Explore before prescribing edits. Read the relevant source, tests, documentation, and history. Ask focused questions only when the answer changes the design contract. Resolve ordinary implementation details from repository evidence.

Prefer milestones that leave the system in a working state. If a milestone fails verification, repair it before moving forward. Use prototypes only to answer a named uncertainty, with explicit promotion or discard criteria.

Do not hide uncertainty behind vague tasks such as “update the code,” “add tests,” or “handle edge cases.” Name the files or systems, expected behavior, and proof.

## Review checklist

Before saving a plan, verify:

- The outcome is observable.
- Acceptance criteria cover every explicit user requirement.
- Every milestone can be verified independently.
- Commands and expected results are concrete when known.
- Risks and destructive operations have recovery paths.
- Decisions do not depend on missing conversation history.
- The final milestone proves the complete user flow, not only compilation.

Use `save_plan` to store the structured result when pi-loop Plan mode is active.

## Sources

- https://developers.openai.com/cookbook/articles/codex_exec_plans
- https://developers.openai.com/codex/learn/best-practices
- https://code.claude.com/docs/en/best-practices
