/** @effect-diagnostics effect/strictEffectProvide:skip-file effect/preferSchemaOverJson:skip-file */
import { describe, it, expect } from "effect-bun-test";
import { Effect, Exit } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { wireHooks, copyStarterPrinciples } from "../../../src/brain/commands/init.js";
import { ConfigError } from "../../../src/brain/errors/index.js";
import { BuildInfo } from "../../../src/brain/services/BuildInfo.js";

const TestLayer = BunServices.layer;

const readSettings = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const raw = yield* fs.readFileString(path);
    return JSON.parse(raw) as Record<string, unknown>;
  });

describe("wireHooks", () => {
  it.scoped("adds SessionStart + PostToolUse hooks to empty settings", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const settingsPath = `${dir}/settings.json`;

      const changed = yield* wireHooks(settingsPath);

      expect(changed).toBe(true);

      const settings = yield* readSettings(settingsPath);
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
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("preserves existing hooks", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const settingsPath = `${dir}/settings.json`;

      yield* fs.writeFileString(
        settingsPath,
        JSON.stringify({
          hooks: {
            SessionStart: [{ matcher: ".*", hooks: [{ type: "command", command: "echo hi" }] }],
          },
        }),
      );

      yield* wireHooks(settingsPath);

      const settings = yield* readSettings(settingsPath);
      const hooks = settings["hooks"] as Record<string, unknown[]>;

      expect(hooks["SessionStart"]).toHaveLength(2);
      const first = hooks["SessionStart"]![0] as { hooks: Array<{ command: string }> };
      expect(first.hooks[0]!.command).toBe("echo hi");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("updates matcher on existing brain inject hook", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const settingsPath = `${dir}/settings.json`;

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

      const changed = yield* wireHooks(settingsPath);

      expect(changed).toBe(true);

      const settings = yield* readSettings(settingsPath);
      const hooks = settings["hooks"] as Record<string, unknown[]>;
      const session = hooks["SessionStart"]![0] as { matcher: string };
      expect(session.matcher).toBe("startup|resume");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("is idempotent — no change on second run", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const settingsPath = `${dir}/settings.json`;

      yield* wireHooks(settingsPath);
      const secondChanged = yield* wireHooks(settingsPath);

      expect(secondChanged).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );

  for (const [label, content] of [
    ["null", "null"],
    ["array", "[]"],
    ["boolean", "true"],
  ] as const) {
    it.scoped(`rejects malformed settings.json (${label})`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const settingsPath = `${dir}/settings.json`;

        yield* fs.writeFileString(settingsPath, content);

        const exit = yield* wireHooks(settingsPath).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const reasons = exit.cause.reasons as unknown as ReadonlyArray<{ error: unknown }>;
          expect(reasons[0]!.error).toBeInstanceOf(ConfigError);
        }
      }).pipe(Effect.provide(TestLayer)),
    );
  }

  it.scoped("warns and returns false when hooks is not an object", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const settingsPath = `${dir}/settings.json`;

      yield* fs.writeFileString(settingsPath, JSON.stringify({ hooks: "not-an-object" }));

      const changed = yield* wireHooks(settingsPath);
      expect(changed).toBe(false);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("treats non-array hook value as empty array", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const settingsPath = `${dir}/settings.json`;

      yield* fs.writeFileString(
        settingsPath,
        JSON.stringify({ hooks: { SessionStart: "not-array" } }),
      );

      const changed = yield* wireHooks(settingsPath);
      expect(changed).toBe(true);

      const settings = yield* readSettings(settingsPath);
      const hooks = settings["hooks"] as Record<string, unknown[]>;
      expect(hooks["SessionStart"]).toHaveLength(1);
      const session = hooks["SessionStart"]![0] as { hooks: Array<{ command: string }> };
      expect(session.hooks[0]!.command).toBe("okra brain inject");
    }).pipe(Effect.provide(TestLayer)),
  );
});

describe("starter principles", () => {
  it.scoped("copies starter files to empty principles dir", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const fakeRoot = `${dir}/repo`;
      const starterDir = `${fakeRoot}/starter/principles`;
      const vaultDir = `${dir}/vault`;
      const principlesDir = `${vaultDir}/principles`;

      yield* fs.makeDirectory(starterDir, { recursive: true });
      yield* fs.makeDirectory(principlesDir, { recursive: true });

      yield* fs.writeFileString(`${starterDir}/first.md`, "# First Principle\n");
      yield* fs.writeFileString(`${starterDir}/second.md`, "# Second Principle\n");
      yield* fs.writeFileString(`${fakeRoot}/starter/principles.md`, "# Principles Index\n");

      yield* copyStarterPrinciples(vaultDir).pipe(
        Effect.provide(BuildInfo.layerTest({ repoRoot: fakeRoot })),
      );

      const copied = yield* fs.readDirectory(principlesDir);
      expect(copied.sort()).toEqual(["first.md", "second.md"]);

      const content = yield* fs.readFileString(`${principlesDir}/first.md`);
      expect(content).toBe("# First Principle\n");

      const indexContent = yield* fs.readFileString(`${vaultDir}/principles.md`);
      expect(indexContent).toBe("# Principles Index\n");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.scoped("does NOT copy when principles/ is non-empty", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();

      const fakeRoot = `${dir}/repo`;
      const starterDir = `${fakeRoot}/starter/principles`;
      const vaultDir = `${dir}/vault`;
      const principlesDir = `${vaultDir}/principles`;

      yield* fs.makeDirectory(starterDir, { recursive: true });
      yield* fs.makeDirectory(principlesDir, { recursive: true });

      yield* fs.writeFileString(`${starterDir}/starter.md`, "# Starter\n");
      yield* fs.writeFileString(`${principlesDir}/existing.md`, "# Existing\n");

      yield* copyStarterPrinciples(vaultDir).pipe(
        Effect.provide(BuildInfo.layerTest({ repoRoot: fakeRoot })),
      );

      const files = yield* fs.readDirectory(principlesDir);
      expect(files).toEqual(["existing.md"]);
      expect(files).not.toContain("starter.md");
    }).pipe(Effect.provide(TestLayer)),
  );
});
