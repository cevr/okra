---
name: meditate
description: Audit brain vault quality — prune noise, merge overlaps, distill unstated principles, review skills. Use when user says "meditate", "audit the brain", "brain cleanup", or vault quality needs attention.
---

# Meditate

Quality audit of the brain vault. Prune noise, merge overlaps, distill unstated principles, review skills.

**Quality bar**: notes must be **high-signal** (Claude would reliably get this wrong without it), **high-frequency** (comes up in most sessions or most tasks of a type), or **high-impact** (getting it wrong causes significant damage or wasted work). Notes that fail all three — delete.

## Process

**Use Tasks to track progress.** Create a task for each step (TaskCreate), mark each in_progress when starting and completed when done (TaskUpdate).

### 1. Build snapshots

```bash
VAULT=$(okra brain vault)
okra brain snapshot "$VAULT" --output /tmp/brain-snapshot.md
SKILLS_DIR=~/.claude/skills
okra brain snapshot "$SKILLS_DIR" --output /tmp/skills-snapshot.md
```

Also locate the auto-memory directory: `~/.claude/projects/<project>/memory/`.

### 2. Spawn Auditor subagent

`Task` with `subagent_type: "general-purpose"`, `model: "sonnet"`. See `references/agents.md` for full prompt spec.

Flags: Outdated, Redundant, Low-value, Verbose, Orphaned. Also audits CLAUDE.md and auto-memory.

**Early-exit gate**: if <3 actionable items found, skip step 3.

### 3. Spawn Reviewer subagent

Same config. See `references/agents.md` for full prompt spec.

Three sections:

1. **Synthesis** — missing wikilinks between related notes, tensions between notes, rewording suggestions
2. **Distillation** — unstated principles evidenced by 2+ existing notes. Must be independent, actionable, and non-obvious
3. **Skill review** — contradictions between skills and principles, structural enforcement gaps, description frontmatter bloat

### 4. Route skill-specific findings

Check all reports for findings that belong in skill files, not `brain/`. Update the skill's SKILL.md or references/ directly. Read the skill first to avoid duplication.

### 5. Apply changes

Work through findings systematically:

- **Outdated** notes → update with current state or delete
- **Redundant** notes → merge into the stronger note, delete the weaker
- **Low-value** notes → delete
- **Verbose** notes → condense in place
- **New connections** → add wikilinks between related notes
- **Tensions** → reword notes to clarify boundaries
- **New principles** (from distillation only) → write file + update `principles.md`. Only if truly independent — not a restatement
- **Merge principles** → look for subsets. Merge narrower into broader
- **CLAUDE.md issues** → rewrite or delete stale instructions
- **Stale memories** → delete or rewrite outdated auto-memory entries

### 6. Housekeep

Update `brain/index.md` for any files added or removed. Run `okra brain reindex`.

### 7. Cleanup

```bash
rm /tmp/brain-snapshot.md /tmp/skills-snapshot.md
```

## Summary format

```
## Pruned
N deleted, M condensed, K merged

## Extracted
N new principles (with evidence citations)

## Skill Review
N findings, M applied

## Housekeep
Index updated: [yes/no]
```
