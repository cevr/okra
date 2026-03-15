import { ConfigProvider, Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { BunServices } from "@effect/platform-bun";
import { StoreService } from "../../src/schedule/services/Store.js";

export const withTempDir = <A, E, R>(fn: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    return yield* fn(dir);
  }).pipe(Effect.scoped);

export const testStoreLayer = (dir: string) =>
  StoreService.layer.pipe(
    Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: dir }))),
    Layer.provideMerge(BunServices.layer),
  );
