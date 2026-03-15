import { Effect, Layer, ServiceMap } from "effect";

export class BuildInfo extends ServiceMap.Service<
  BuildInfo,
  {
    readonly repoRoot: string;
    readonly version: string;
  }
>()("@cvr/okra/brain/services/BuildInfo") {
  /** Production layer — reads compile-time constants injected by scripts/build.ts */
  static layer: Layer.Layer<BuildInfo> = Layer.effect(
    BuildInfo,
    Effect.sync(() => ({
      repoRoot:
        typeof __ASSET_ROOT__ !== "undefined"
          ? __ASSET_ROOT__
          : new URL("../../..", import.meta.url).pathname.replace(/\/$/, ""),
      version: typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev",
    })),
  );

  /** Test layer with explicit values */
  static layerTest = (opts: { repoRoot: string; version?: string }) =>
    Layer.succeed(BuildInfo, {
      repoRoot: opts.repoRoot,
      version: opts.version ?? "0.0.0-test",
    });
}
