---
name: reflect
description: Extract session learnings into persistent brain memory. Use at session end, after mistakes, when user says "reflect", "remember this", "what did we learn", or during session wrap-up.
---

# Reflect

Mine the current conversation for brain-worthy knowledge.

## Process

1. **Read the brain index**

   ```bash
   VAULT=$(okra brain vault)
   cat "$VAULT/index.md"
   ```

   Then read `$VAULT/principles.md` and any principles relevant to the session.

2. **Scan the conversation** for:
   - Mistakes made and corrections applied
   - User preferences discovered
   - Codebase knowledge worth preserving
   - Tool quirks or workarounds
   - Decisions and their rationale
   - Friction in skill execution, orchestration, or delegation
   - Repeated manual steps that could be automated

3. **Skip** anything trivial, one-off, or already captured in the brain.

4. **Structural enforcement check** — before routing a learning to `brain/`, ask: can this be a lint rule, script, metadata flag, or runtime check? If yes, encode it structurally and skip the brain note. See `$(okra brain vault)/principles/encode-lessons-in-structure.md`.

5. **Route each learning**:

   **Brain files**: one topic per file, group in directories with index files using wikilinks, no inlined content in index files.
   | Destination | When |
   |-------------|------|
   | `$(okra brain vault)/principles/` | General engineering principle |
   | `$(okra brain vault)/projects/<project-name>/` | Project-specific knowledge (auto-detected by git root / cwd) |
   | `$(okra brain vault)/` root | Cross-cutting knowledge |

   **Skill improvements**: update `~/.claude/skills/<skill>/` directly if the learning is about a skill's own process.

   **Backlog items**: bugs, non-trivial rewrites, tooling gaps — capture as todos, not brain notes.

6. **Write files** to the vault. The PostToolUse hook auto-rebuilds `index.md`.

7. **Update entrypoints** — if you added a principle, update `$(okra brain vault)/principles.md`. Update `$(okra brain vault)/index.md` if files were added or removed.

## Output format

```
## Brain
- [file] — one-line description

## Skills
- [skill] — what changed

## Structural
- [enforcement] — what was encoded in tooling

## Todos
- [item] — follow-up work
```
