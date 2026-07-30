import { Effect, Layer, Context } from "effect";

export class BuildInfo extends Context.Service<
  BuildInfo,
  {
    readonly repoRoot: string;
    readonly version: string;
  }
>()("@cvr/okra/brain/services/BuildInfo") {
  /** Production layer — reads compile-time constants injected by scripts/build.ts */
  static layer: Layer.Layer<BuildInfo> = Layer.effect(
    BuildInfo,
    Effect.sync(() => {
      function resolveRepoRoot(): string {
        if (typeof __ASSET_ROOT__ !== "undefined") {
          return __ASSET_ROOT__;
        }
        return new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
      }

      function resolveVersion(): string {
        if (typeof __VERSION__ !== "undefined") {
          return __VERSION__;
        }
        return "0.0.0-dev";
      }

      return {
        repoRoot: resolveRepoRoot(),
        version: resolveVersion(),
      };
    }),
  );

  /** Test layer with explicit values */
  static layerTest = (opts: { repoRoot: string; version?: string }) =>
    Layer.succeed(BuildInfo, {
      repoRoot: opts.repoRoot,
      version: opts.version ?? "0.0.0-test",
    });
}
