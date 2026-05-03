import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";

export const resolveExecutable = Effect.fn("resolveExecutable")(function* (name: string) {
  const path = Bun.which(name);
  if (path !== null) return path;
  // Fallback: check common locations when PATH is incomplete (e.g. daemon context)
  const fs = yield* FileSystem;
  const home = process.env["HOME"] ?? "";
  const candidates = [
    `${home}/.bun/bin/${name}`,
    `/usr/local/bin/${name}`,
    `${home}/.local/bin/${name}`,
  ];
  for (const candidate of candidates) {
    const exists = yield* fs.exists(candidate).pipe(Effect.catch(() => Effect.succeed(false)));
    if (exists) return candidate;
  }
  return name;
});
