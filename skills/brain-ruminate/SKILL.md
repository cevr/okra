---
name: ruminate
description: Mine full conversation history archives for brain-worthy knowledge that reflect missed. Use when user says "ruminate", "mine my history", "mine conversations", or wants to extract patterns from past sessions.
---

# Ruminate

Deep-mine full conversation archives for knowledge `/reflect` missed. This is the batch version — it processes all past conversations, not just the current one.

## Process

**Use Tasks to track progress.** Create a task for each step.

### 1. Build brain snapshot

```bash
VAULT=$(okra brain vault)
okra brain snapshot "$VAULT" --output /tmp/brain-snapshot-ruminate.md
```

### 2. Locate conversations

```bash
# List project dirs and pick the one matching your project
ls ~/.claude/projects/
# The naming convention is: dash-separated absolute path with leading dash
# e.g. /Users/you/project → -Users-you-project
CONV_DIR=~/.claude/projects/<pick-matching-dir>/
```

### 3. Extract and batch

```bash
OUT_DIR=/tmp/brain-ruminate
okra brain extract "$CONV_DIR" "$OUT_DIR" --batches N
# N ≈ 1 per 20 conversations, min 2, max 10
```

Creates numbered conversation text files and batch manifests at `$OUT_DIR/batches/batch_N.txt`.

### 4. Parallel mining

Spawn N parallel `Task` agents (`subagent_type: "general-purpose"`, `model: "opus"`), one per batch.

**Per-agent prompt must include**:

- Path to brain snapshot: `/tmp/brain-snapshot-ruminate.md`
- Path to batch manifest: `$OUT_DIR/batches/batch_N.txt`
- List of already-captured topics (extracted from brain snapshot)
- Output path for findings

**Each agent extracts**:

- **User corrections** — things the user repeatedly corrects
- **Recurring preferences** — consistent choices across sessions
- **Technical learnings** — codebase knowledge, tool quirks
- **Workflow patterns** — repeated sequences of actions
- **Frustrations** — things that repeatedly go wrong
- **Wished-for skills** — capabilities requested but not available

For each finding, cite the conversation file(s) where evidence was found. Skip anything already in the brain snapshot.

### 5. Synthesize

Read all agent findings. Cross-reference with brain snapshot. Deduplicate aggressively.

Filter by:

- **Frequency** — patterns across multiple conversations, not single incidents. One-off mistakes don't count unless they reveal a systemic gap
- **Factual accuracy** — verify claims against codebase. Corrections are always worth fixing
- **Impact** — would having this knowledge change behavior? Repeated wasted effort is high signal

Discard aggressively. It's better to present 3 high-signal findings than 9 that include noise.

### 6. Present and apply

Present as table:

| Finding | Frequency / Evidence | Proposed action |
| ------- | -------------------- | --------------- |
| ...     | ...                  | ...             |

Be honest about one-offs vs patterns. Route skill-specific learnings: check the skill's SKILL.md first, then update directly.

Apply only user-approved changes. When writing to brain:

- One topic per file
- Use wikilinks `[[section/file-name]]`
- Update `brain/index.md`
- Prefer updating existing notes over creating new ones

### 7. Cleanup

```bash
rm -rf "$OUT_DIR" /tmp/brain-snapshot-ruminate.md
```

## Guidelines

- **Filter aggressively** — the brain is high-value, high-density. Don't dilute it
- **Prefer reduction** — update existing notes rather than creating new ones
- **Quote the user** — direct corrections carry the most signal. Preserve the user's actual words when possible
- **Shut down agents when complete** — don't leave them running
