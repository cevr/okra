---
"@cvr/okra": minor
---

Align with `project-scaffolding` skill spec: full Effect v4 idioms with strict tsgo diagnostics.

- Route all `process.env` access through `Config.option(Config.string(...)).asEffect()` so env reads honor the ambient `ConfigProvider` (enables `ConfigProvider.layer(...)` / `Effect.provideService` injection in tests instead of mutating `process.env`).
- Replace `new Date()` with `Clock.currentTimeMillis` / `DateTime.now` across `src/`; threading explicit `nowMs` into pure modules (`Schedule.parse`, `StopEvaluator.evaluate`, `formatRelativeTime`, `generateSlug`).
- Convert remaining `async function` blocks to `Effect.fn` with `Effect.tryPromise({ try: () => proc.exited })` shape.
- Migrate tests to `effect-bun-test` patterns: `it.scoped` + `FileSystem.makeTempDirectoryScoped`, `it.scopedLive` where production code uses the real Clock, `ConfigProvider.fromEnv({ env })` for env injection.
- Refactor 4 high-complexity functions inline (`Schedule.parseSync`, `ExperimentLog.reconstructFromEvents`, `Loop.run`, `init` handler, `brain extract.extractConversations`) without raising the `complexity: 20` lint ceiling.
- `lefthook.yml`: collapse pre-commit to a single `parallel: true` stage (`lint+fmt && typecheck && build && test` chained).
- `.oxlintrc.json`: disable `no-underscore-dangle`, `consistent-return`, and three noisy `typescript/no-unnecessary-*` rules.
- `tsconfig.json`: enable all Effect diagnostics at error severity except `effectMapFlatten`, `missedPipeableOpportunity`, `strictBooleanExpressions`, `unnecessaryPipe`, `unnecessaryPipeChain`; tests override only `strictEffectProvide`; scripts override every rule off.
