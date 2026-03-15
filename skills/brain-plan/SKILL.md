---
name: plan
description: Create structured implementation plans grounded in brain vault principles. Planning only — no implementation. Use when user says "plan this", "break this down", or needs a structured approach before coding.
---

# Plan

Create structured implementation plans stored in the brain vault. **Planning only — no implementation.**

## Process

**Use Tasks to track progress.** Create a task for each step (TaskCreate), mark each in_progress when starting and completed when done (TaskUpdate). Check TaskList after completing each step.

### 0. Triage complexity

Trivially small (1-2 files, obvious approach)? Tell the user and stop — don't plan what doesn't need planning.

**Needs planning when**: 3+ files or new architecture, multiple valid approaches, unclear scope or cross-cutting concerns, user explicitly asks.

### 1. Load principles

Read `$(okra brain vault)/principles.md`. Follow every `[[wikilink]]` and read each linked principle file. These principles govern all plan decisions — refer back to them throughout.

**Do NOT skip this. Do NOT use memorized principle content — always read fresh.**

### 2. Define scope

Use `AskUserQuestion` to clarify:

- What's in scope / out of scope?
- Constraints (dependencies, platform, patterns)?
- What does "done" look like?

Frame questions with concrete options. If the request is already clear, confirm scope boundaries briefly and move on.

### 3. Explore context

**Always** delegate exploration to subagents via the `Task` tool. Never do large-scale codebase exploration in the main context.

Explore agents should:

- Read existing code in the affected areas
- Identify patterns, conventions, and dependencies
- Map the architecture around the change
- Find relevant tests, types, and infrastructure

Use parallel `Explore` subagents for independent areas.

### 4. Gather domain skills

Check `~/.claude/skills/` for matching skills. Invoke matched skills, read output, and incorporate patterns. If a domain isn't covered, use `find-skills` to search for and install relevant skills. Delete one-off skills after the plan is complete.

### 5. Write the plan

**Location**: `$(okra brain vault)/plans/NN-slug-name/`

```
$(okra brain vault)/plans/42-mvp/
├── overview.md
├── 01-scaffold.md
├── 02-core-types.md
├── 03-services.md
├── testing.md          # non-phase files are fine alongside phases
└── ...
```

Single file for small plans: `$(okra brain vault)/plans/NN-slug-name.md`

**Overview must include**:

- **Context** — why this plan exists
- **Scope** — what's in, what's out
- **Constraints** — tech/time/compat limits. For architectural decisions, sketch 2-3 approaches and state which was chosen and why
- **Applicable skills** — which skills to invoke during implementation
- **Phases** — ordered wikilinks: `[[plans/42-mvp/01-scaffold]]`
- **Verification** — how to know the whole thing is done

**Phase files must include**:

- Back-link: `Part of [[plans/42-mvp/overview]]`
- **Goal** — one sentence
- **Changes** — which files, what changes at a high level
- **Data structures** — name key types, one-line sketch. Don't write full definitions
- **Verification** — static (typecheck, lint, tests) + runtime (manual test, automated test, edge cases)

**Phase sizing**: 1 function/type + tests per phase, or 1 bug fix. Max 2-3 files. Prefer 8-10 small over 3-4 large. Split if >5 test cases or >3 functions.

### 6. Verification strategy

Every phase needs both:

**Static checks**: type checking, linting, conventions, tests pass.

**Runtime checks**: manual testing paths, automated test expectations, edge cases to verify, UI screenshot verification where applicable.

"It compiles" is not verification.

### 7. Design checks

For changes touching existing code, apply redesign-from-first-principles: "If we were building this from scratch with this requirement, what would we build?" Don't bolt changes onto existing designs — redesign holistically.

If a phase involves creating or updating a skill, the phase must instruct the implementer to use the `skill-creator` skill during that phase.

### 8. Update indexes

Update `$(okra brain vault)/plans/index.md`. Do NOT edit `brain/index.md` — the auto-index hook maintains it automatically.

### 9. Present to user

Summarize the plan: list the phases, scope boundaries, applicable skills, and verification approach. Ask the user to review the plan files.

**Stop here. Do not begin implementation.**

## Plan principles

- **Keep plans high-level.** Describe _what_ and _why_, not _how_ at the code level. A phase should read like a brief to a senior engineer: goals, boundaries, key types, and verification — not code snippets or pseudocode
- **Order phases**: infrastructure and shared types first, features after. Each phase should be independently shippable
