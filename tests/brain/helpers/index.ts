import { Effect } from "effect";
import { FileSystem } from "effect/FileSystem";

export const withTempDir = <A, E, R>(fn: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    return yield* fn(dir);
  }).pipe(Effect.scoped);
