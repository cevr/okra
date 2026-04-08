// @effect-diagnostics effect/strictBooleanExpressions:off
import { Effect, FileSystem, Path } from "effect";

export const walkDir = Effect.fn("walkDir")(function* (dirPath: string) {
  const fs = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;

  const files: Array<{ path: string; content: string }> = [];

  const walk = (currentDir: string, prefix: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const entries = yield* fs.readDirectory(currentDir).pipe(Effect.orDie);
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        const fullPath = pathService.join(currentDir, entry);
        const stat = yield* fs.stat(fullPath).pipe(Effect.orDie);
        if (stat.type === "Directory") {
          yield* walk(fullPath, prefix ? `${prefix}/${entry}` : entry);
        } else {
          const content = yield* fs.readFileString(fullPath).pipe(Effect.orDie);
          files.push({ path: prefix ? `${prefix}/${entry}` : entry, content });
        }
      }
    });

  yield* walk(dirPath, "");
  return files;
});
