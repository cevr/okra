import { describe, expect, it } from "effect-bun-test";
import { ConfigProvider, Console, Effect, Layer, Option, Ref, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { FetchHttpClient } from "effect/http";
import { BunServices } from "@effect/platform-bun";
import { runAdd } from "../../../src/skills/commands/add.js";
import { runUpdate, UpdateReport } from "../../../src/skills/commands/update.js";
import { runRemove } from "../../../src/skills/commands/remove.js";
import { GitHub, type GitHubShape } from "../../../src/skills/services/GitHub.js";
import { SkillLock, SkillLockLive } from "../../../src/skills/services/SkillLock.js";
import { SkillStore, SkillStoreLive } from "../../../src/skills/services/SkillStore.js";

const skillMd = "---\nname: binary-skill\ndescription: Binary assets — café\n---\n\nContent\n";
const original = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...Array.from({ length: 256 }, (_, byte) => byte),
]);
const updated = original.slice();
// Both invalid UTF-8 bytes decode to the same replacement character.
updated[updated.length - 1] = 0xfe;

const decodeReport = Schema.decodeUnknownSync(Schema.fromJsonString(UpdateReport));

const checkUpdate = Effect.gen(function* () {
  const stdout: Array<string> = [];
  yield* runUpdate({ dryRun: true, json: true }).pipe(
    Effect.provideService(Console.Console, {
      ...globalThis.console,
      log: (line: unknown) => {
        stdout.push(String(line));
      },
    }),
  );
  expect(stdout).toHaveLength(1);
  return decodeReport(stdout[0]);
});

describe("binary skill files", () => {
  for (const source of ["local", "github"] as const) {
    for (const operation of ["add", "update"] as const) {
      it.scoped(`preserves every byte on ${operation} from ${source}`, () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem;
          const dir = yield* fs.makeTempDirectoryScoped();
          const sourceDir = yield* fs.makeTempDirectoryScoped();
          yield* fs.makeDirectory(`${sourceDir}/assets`, { recursive: true });
          yield* fs.writeFileString(`${sourceDir}/SKILL.md`, skillMd);
          yield* fs.writeFile(`${sourceDir}/assets/example.png`, original);
          const remoteBytes = yield* Ref.make(original);
          const unexpected = () => Effect.die("Unexpected GitHub operation");
          const github: GitHubShape = {
            listContents: unexpected,
            listTree: unexpected,
            discoverSkills: unexpected,
            fetchRaw: () => Effect.succeed(new TextEncoder().encode(skillMd)),
            fetchSkillDir: () =>
              Ref.get(remoteBytes).pipe(
                Effect.map((content) => [
                  { path: "SKILL.md", content: new TextEncoder().encode(skillMd) },
                  { path: "assets/example.png", content },
                ]),
              ),
          };
          const layer = SkillLockLive.pipe(
            Layer.provideMerge(SkillStoreLive),
            Layer.provideMerge(GitHub.layerTest(github)),
            Layer.provideMerge(BunServices.layer),
            Layer.provideMerge(FetchHttpClient.layer),
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ SKILLS_DIR: dir }))),
          );

          yield* Effect.gen(function* () {
            let input = sourceDir;
            if (source === "github") input = "acme/repo@binary-skill";
            yield* runAdd([input]);
            let expected = original;
            if (operation === "update") {
              yield* fs.writeFile(`${sourceDir}/assets/example.png`, updated);
              yield* Ref.set(remoteBytes, updated);
              const report = yield* checkUpdate;
              expect(report.outdated.map((skill) => skill.name)).toEqual(["binary-skill"]);
              expect(report.unchanged).toBe(0);
              expect(yield* fs.readFile(`${dir}/binary-skill/assets/example.png`)).toEqual(
                original,
              );
              yield* runUpdate();
              expected = updated;
            }
            expect(yield* fs.readFile(`${dir}/binary-skill/assets/example.png`)).toEqual(expected);
            expect(yield* fs.readFileString(`${dir}/binary-skill/SKILL.md`)).toBe(skillMd);
            const store = yield* SkillStore;
            expect(yield* store.list).toEqual([
              {
                name: "binary-skill",
                description: "Binary assets — café",
                dirPath: `${dir}/binary-skill`,
              },
            ]);
            const lock = yield* SkillLock;
            expect(Option.isSome(yield* lock.get("binary-skill"))).toBe(true);

            // Freshly read arrays with identical bytes must compare unchanged.
            expect(yield* checkUpdate).toEqual({
              dryRun: true,
              outdated: [],
              failed: [],
              unchanged: 1,
            });
            yield* runRemove(["binary-skill"]);
            expect(yield* fs.exists(`${dir}/binary-skill`)).toBe(false);
            expect(Option.isNone(yield* lock.get("binary-skill"))).toBe(true);
          }).pipe(Effect.provide(layer));
        }).pipe(Effect.provide(BunServices.layer)),
      );
    }
  }
});
