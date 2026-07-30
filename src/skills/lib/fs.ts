import { Effect, FileSystem, Path } from "effect";

const joinRelative = (prefix: string, entry: string): string => {
  if (prefix.length === 0) return entry;
  return `${prefix}/${entry}`;
};

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
        const relativePath = joinRelative(prefix, entry);
        const stat = yield* fs.stat(fullPath).pipe(Effect.orDie);
        if (stat.type === "Directory") {
          yield* walk(fullPath, relativePath);
        } else {
          const content = yield* fs.readFileString(fullPath).pipe(Effect.orDie);
          files.push({ path: relativePath, content });
        }
      }
    });

  yield* walk(dirPath, "");
  return files;
});
