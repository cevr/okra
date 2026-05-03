---
"@cvr/okra": patch
---

Dev tooling: switch from `tsc` + `@effect/language-service` to `tsgo` (`@typescript/native-preview`) + `@effect/tsgo`.

`tsgo` runs the Effect Language Service plugin natively at the CLI, which surfaced pre-existing diagnostic warnings the old toolchain silently dropped. As part of the swap:

- Replaced raw `node:fs` / `node:path` usage with Effect platform services (`FileSystem`, `Path`) across research services/commands, brain daemon state, and `shared/executable` — removing the need for `@effect-diagnostics nodeBuiltinImport:off` pragmas in production code.
- Replaced `JSON.parse` / `JSON.stringify` with `Schema.fromJsonString` across CLI `--json` output, state files, and tests.
- Converted `SkillLock.addMany` / `updateMany` to `Effect.fn` form.
- Replaced `instanceof ResearchError` with a `_tag` discriminator check.
- Refactored `SkillStore.readDir` so `FileSystem | Path` requirements bubble through the type system rather than being provided mid-pipeline.
- Globally disabled `strictBooleanExpressions` (style preference, not correctness).

Runtime behavior is unchanged. This is a build/dev-tooling commit.
