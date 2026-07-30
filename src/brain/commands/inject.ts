import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { ConfigService } from "../services/Config.js";
import { VaultService } from "../services/Vault.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

const InjectOutput = Schema.Struct({
  global: Schema.String,
  project: Schema.NullOr(Schema.String),
  projectName: Schema.NullOr(Schema.String),
  projectNotes: Schema.NullOr(Schema.String),
  index: Schema.String,
});
const encodeInjectOutput = Schema.encodeSync(Schema.fromJsonString(InjectOutput));

const nullUnless = (present: boolean, value: string): string | null => {
  if (present) {
    return value;
  }
  return null;
};

/** Appends a section with a leading newline, or nothing when the section is empty. */
const prefixedSection = (section: string): string => {
  if (section.length === 0) {
    return "";
  }
  return "\n" + section;
};

export const inject = Command.make("inject", { json: jsonFlag }).pipe(
  Command.withDescription("Inject vault index into session (SessionStart hook)"),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const vault = yield* VaultService;
      const fs = yield* FileSystem;
      const path = yield* Path;

      const [globalPath, projectPath] = yield* Effect.all([
        config.globalVaultPath,
        config.projectVaultPath,
      ]);

      const readIndexSafe = (p: string) =>
        vault.readIndex(p).pipe(
          Effect.catchTag("@cvr/okra/brain/VaultError", (e) => {
            if (e.code === "INDEX_MISSING" || e.code === "READ_FAILED") {
              return Console.error(
                `okra brain: vault not found at ${p} — run \`okra brain init\``,
              ).pipe(Effect.as(""));
            }
            return Effect.fail(e);
          }),
        );

      // Read indexes concurrently when project vault exists
      const readIndexes = Effect.fn("brain.inject.readIndexes")(function* () {
        if (Option.isSome(projectPath)) {
          return yield* Effect.all([readIndexSafe(globalPath), readIndexSafe(projectPath.value)]);
        }
        return [yield* readIndexSafe(globalPath), ""] as const;
      });
      const [globalIndex, projectIndex] = yield* readIndexes();

      // Both empty means no vault — already warned to stderr, exit cleanly
      if (globalIndex.length === 0 && projectIndex.length === 0) return;

      // Detect project-specific notes in global vault's projects/<name>/
      const projectName = yield* config.currentProjectName;
      let projectNotes = "";
      let detectedProject = Option.none<string>();
      if (Option.isSome(projectName)) {
        const projectDir = path.join(globalPath, "projects", projectName.value);
        const dirExists = yield* fs.exists(projectDir).pipe(Effect.orElseSucceed(() => false));
        if (dirExists) {
          const files = yield* vault
            .listFiles(projectDir)
            .pipe(Effect.orElseSucceed(() => [] as string[]));
          if (files.length > 0) {
            detectedProject = Option.some(projectName.value);
            projectNotes = files.map((f) => `- [[projects/${projectName.value}/${f}]]`).join("\n");
          }
        }
      }

      if (json) {
        const projectField = nullUnless(
          Option.isSome(projectPath) && projectIndex.length > 0,
          projectIndex,
        );
        const projectNotesField = nullUnless(projectNotes.length > 0, projectNotes);
        const index = globalIndex + prefixedSection(projectNotes) + prefixedSection(projectIndex);

        yield* Console.log(
          encodeInjectOutput({
            global: globalIndex,
            project: projectField,
            projectName: Option.getOrNull(detectedProject),
            projectNotes: projectNotesField,
            index,
          }),
        );
        return;
      }

      let output = "Brain vault — read relevant files before acting:\n\n";
      output += globalIndex;

      if (projectNotes.length > 0) {
        output += `\n## Project: ${Option.getOrThrow(detectedProject)}\n${projectNotes}\n`;
      }

      if (Option.isSome(projectPath) && projectIndex.length > 0) {
        output += "\n---\n\n";
        output += `Project vault: ${projectPath.value}\n\n`;
        output += projectIndex;
      }

      yield* Console.log(output);
    }),
  ),
);
