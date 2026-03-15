/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Exit } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { BunServices } from "@effect/platform-bun";
import { wireHooks, copyStarterPrinciples } from "../../../src/brain/commands/init.js";
import { ConfigError } from "../../../src/brain/errors/index.js";
import { BuildInfo } from "../../../src/brain/services/BuildInfo.js";
import { withTempDir } from "../helpers/index.js";

const TestLayer = BunServices.layer;

const readSettings = (fs: FileSystem, path: string) =>
  fs.readFileString(path).pipe(Effect.map((s) => JSON.parse(s) as Record<string, unknown>));

describe("wireHooks", () => {
  it.live("adds SessionStart + PostToolUse hooks to empty settings", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const settingsPath = `${dir}/settings.json`;

        const changed = yield* wireHooks(fs, path, settingsPath);

        expect(changed).toBe(true);

        const settings = yield* readSettings(fs, settingsPath);
        const hooks = settings["hooks"] as Record<string, unknown[]>;

        expect(hooks["SessionStart"]).toHaveLength(1);
        expect(hooks["PostToolUse"]).toHaveLength(1);

        const session = hooks["SessionStart"]![0] as {
          matcher: string;
          hooks: Array<{ command: string }>;
        };
        expect(session.matcher).toBe("startup|resume");
        expect(session.hooks[0]!.command).toBe("okra brain inject");

        const post = hooks["PostToolUse"]![0] as {
          matcher: string;
          hooks: Array<{ command: string }>;
        };
        expect(post.matcher).toBe("brain/");
        expect(post.hooks[0]!.command).toBe("okra brain reindex");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("preserves existing hooks", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const settingsPath = `${dir}/settings.json`;

        // Pre-existing settings with a custom hook
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            hooks: {
              SessionStart: [{ matcher: ".*", hooks: [{ type: "command", command: "echo hi" }] }],
            },
          }),
        );

        yield* wireHooks(fs, path, settingsPath);

        const settings = yield* readSettings(fs, settingsPath);
        const hooks = settings["hooks"] as Record<string, unknown[]>;

        // Original hook preserved + brain inject added
        expect(hooks["SessionStart"]).toHaveLength(2);
        const first = hooks["SessionStart"]![0] as { hooks: Array<{ command: string }> };
        expect(first.hooks[0]!.command).toBe("echo hi");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("updates matcher on existing brain inject hook", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const settingsPath = `${dir}/settings.json`;

        // Hook exists but with old matcher
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            hooks: {
              SessionStart: [
                {
                  matcher: "old-matcher",
                  hooks: [{ type: "command", command: "okra brain inject" }],
                },
              ],
              PostToolUse: [
                { matcher: "brain/", hooks: [{ type: "command", command: "okra brain reindex" }] },
              ],
            },
          }),
        );

        const changed = yield* wireHooks(fs, path, settingsPath);

        expect(changed).toBe(true);

        const settings = yield* readSettings(fs, settingsPath);
        const hooks = settings["hooks"] as Record<string, unknown[]>;
        const session = hooks["SessionStart"]![0] as { matcher: string };
        expect(session.matcher).toBe("startup|resume");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("is idempotent — no change on second run", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const settingsPath = `${dir}/settings.json`;

        yield* wireHooks(fs, path, settingsPath);
        const secondChanged = yield* wireHooks(fs, path, settingsPath);

        expect(secondChanged).toBe(false);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  for (const [label, content] of [
    ["null", "null"],
    ["array", "[]"],
    ["boolean", "true"],
  ] as const) {
    it.live(`rejects malformed settings.json (${label})`, () =>
      withTempDir((dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const path = yield* Path;
          const settingsPath = `${dir}/settings.json`;

          yield* fs.writeFileString(settingsPath, content);

          const exit = yield* wireHooks(fs, path, settingsPath).pipe(Effect.exit);

          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            const reasons = exit.cause.reasons as unknown as ReadonlyArray<{ error: unknown }>;
            expect(reasons[0]!.error).toBeInstanceOf(ConfigError);
          }
        }),
      ).pipe(Effect.provide(TestLayer)),
    );
  }

  it.live("warns and returns false when hooks is not an object", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const settingsPath = `${dir}/settings.json`;

        // hooks is a string instead of an object
        yield* fs.writeFileString(settingsPath, JSON.stringify({ hooks: "not-an-object" }));

        const changed = yield* wireHooks(fs, path, settingsPath);
        expect(changed).toBe(false);
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("treats non-array hook value as empty array", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;
        const settingsPath = `${dir}/settings.json`;

        // SessionStart is a string, not an array — should be treated as empty
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({ hooks: { SessionStart: "not-array" } }),
        );

        const changed = yield* wireHooks(fs, path, settingsPath);
        expect(changed).toBe(true);

        const settings = yield* readSettings(fs, settingsPath);
        const hooks = settings["hooks"] as Record<string, unknown[]>;
        // brain inject was added even though SessionStart was malformed
        expect(hooks["SessionStart"]).toHaveLength(1);
        const session = hooks["SessionStart"]![0] as { hooks: Array<{ command: string }> };
        expect(session.hooks[0]!.command).toBe("okra brain inject");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});

describe("starter principles", () => {
  it.live("copies starter files to empty principles dir", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;

        // Set up a fake repo root with starter dir
        const fakeRoot = `${dir}/repo`;
        const starterDir = `${fakeRoot}/starter/principles`;
        const vaultDir = `${dir}/vault`;
        const principlesDir = `${vaultDir}/principles`;

        yield* fs.makeDirectory(starterDir, { recursive: true });
        yield* fs.makeDirectory(principlesDir, { recursive: true });

        yield* fs.writeFileString(`${starterDir}/first.md`, "# First Principle\n");
        yield* fs.writeFileString(`${starterDir}/second.md`, "# Second Principle\n");
        // Also create principles.md index in starter
        yield* fs.writeFileString(`${fakeRoot}/starter/principles.md`, "# Principles Index\n");

        yield* copyStarterPrinciples(fs, path, vaultDir).pipe(
          Effect.provide(BuildInfo.layerTest({ repoRoot: fakeRoot })),
        );

        const copied = yield* fs.readDirectory(principlesDir);
        expect(copied.sort()).toEqual(["first.md", "second.md"]);

        const content = yield* fs.readFileString(`${principlesDir}/first.md`);
        expect(content).toBe("# First Principle\n");

        // principles.md index was also copied
        const indexContent = yield* fs.readFileString(`${vaultDir}/principles.md`);
        expect(indexContent).toBe("# Principles Index\n");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.live("does NOT copy when principles/ is non-empty", () =>
    withTempDir((dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const path = yield* Path;

        const fakeRoot = `${dir}/repo`;
        const starterDir = `${fakeRoot}/starter/principles`;
        const vaultDir = `${dir}/vault`;
        const principlesDir = `${vaultDir}/principles`;

        yield* fs.makeDirectory(starterDir, { recursive: true });
        yield* fs.makeDirectory(principlesDir, { recursive: true });

        yield* fs.writeFileString(`${starterDir}/starter.md`, "# Starter\n");
        // Pre-existing file in principles
        yield* fs.writeFileString(`${principlesDir}/existing.md`, "# Existing\n");

        yield* copyStarterPrinciples(fs, path, vaultDir).pipe(
          Effect.provide(BuildInfo.layerTest({ repoRoot: fakeRoot })),
        );

        const files = yield* fs.readDirectory(principlesDir);
        expect(files).toEqual(["existing.md"]);
        expect(files).not.toContain("starter.md");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
