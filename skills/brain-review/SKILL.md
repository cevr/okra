---
name: review
description: Principle-grounded code review using brain vault principles. The review IS the deliverable — no changes made. Use when user says "review", "code review", "check this", or wants feedback on code quality against principles.
---

# Review

Principle-grounded code review. **The review IS the deliverable — no changes.**

## Process

**Use Tasks to track progress.** Create a task for each step.

### 1. Load principles

Read `$(okra brain vault)/principles.md`. Follow every `[[wikilink]]` and read each linked principle file.

**Do NOT skip this. Do NOT use memorized principle content — always read fresh.**

### 2. Determine scope

Infer what to review from context — the user's message, recent diffs, or referenced plans/PRs. If genuinely ambiguous (nothing to infer), ask.

**Auto-detect size**:

- **BIG** (50+ lines, 3+ files, new architecture): all sections, max 4 issues per section
- **SMALL** (under thresholds): 1 issue per section max

### 3. Gather context

**SMALL**: read the files directly. Delegation overhead exceeds cost.

**BIG**: delegate to `Explore` subagents via `Task`. Explore targets:

- The code/plan under review
- Dependencies, callers, and downstream consumers
- Types, tests, and infrastructure

### 4. Gather domain skills

Check `~/.claude/skills/` for matching skills. Invoke and incorporate patterns. Use `find-skills` for uncovered domains.

### 5. Assessment pipeline

Run in order:

#### Scope Check

If a plan exists in `$(okra brain vault)/plans/`, run `git diff --stat` and `git log --oneline` for relevant commits. Flag drift from phase scope.

#### Architecture

- System design and component boundaries
- Dependency graph and coupling
- Data flow patterns and bottlenecks
- Security architecture (auth, data access, API boundaries)

#### Code Quality

- Code organization and module structure
- DRY violations (be aggressive)
- Error handling and missing edge cases (call out explicitly)
- Over/under-engineering relative to principles (consider redesign-from-first-principles)
- Technical debt hotspots

#### Tests

- Coverage gaps (unit, integration, e2e)
- Test quality and assertion strength
- Missing edge cases (be thorough)
- Untested failure modes and error paths
- New behavior must have new tests — assert outcomes, not implementation details

#### Performance

- N+1 queries, database access patterns
- Memory concerns
- Caching opportunities
- Slow or high-complexity paths

#### Principle Compliance

Check each applicable principle from `$(okra brain vault)/principles/` against the code under review.

Common violations:

- Bolted-on changes → redesign-from-first-principles
- Missing verification → prove-it-works
- Unnecessary complexity → subtract-before-you-add

### 6. Issue format

Each issue:

```
### N. [title] — [file:line]

**Severity**: high | medium | low

[1-2 sentence description]

**Options**:
A) [option] — effort: low/med/high, risk: low/med/high, impact: [desc], maintenance: [desc]
B) [option] — effort: low/med/high, risk: low/med/high, impact: [desc], maintenance: [desc]
C) Do nothing — [consequence]

**Recommended**: (A) — [principle citation]
```

**Severity**:

- **high**: incorrect behavior, missing tests for critical paths, principle violation that changes architecture
- **medium**: code quality issues, minor gaps, style inconsistencies
- **low**: nitpicks, preferences, optional improvements

When using `AskUserQuestion`, label each option with issue NUMBER and option LETTER. Recommended option is always first.

### 7. Verdict

One of:

- **Accept** — all checks pass, scope clean, tests present and passing
- **Accept with notes** — low-severity only, list for follow-up
- **Revise** — high-severity issues present. Provide specific actionable feedback with file/line/principle

Present all sections together. Ask once at the end.

## Interaction rules

- Don't assume priorities — present findings, let user decide
- Don't make changes — the review IS the deliverable
- Present all sections, then ask once (not per-section)
- Per prove-it-works: note what testing you observed in the description
