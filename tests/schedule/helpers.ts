import { ConfigProvider, Layer } from "effect";
import { BunServices } from "@effect/platform-bun";
import { StoreService } from "../../src/schedule/services/Store.js";

export const testStoreLayer = (dir: string) =>
  StoreService.layer.pipe(
    Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: dir }))),
    Layer.provideMerge(BunServices.layer),
  );
