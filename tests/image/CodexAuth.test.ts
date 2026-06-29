import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { layerNoop } from "effect/FileSystem";
import { PlatformError, SystemError } from "effect/PlatformError";
import * as BunPath from "@effect/platform-bun/BunPath";
import { describe, expect, it } from "effect-bun-test";
import { isImageError } from "../../src/image/errors.js";
import { CodexAuthService } from "../../src/image/services/CodexAuth.js";

const notFound = () =>
  Effect.fail(
    new PlatformError(
      new SystemError({ _tag: "NotFound", module: "FileSystem", method: "readFileString" }),
    ),
  );

const AUTH_JSON = JSON.stringify({
  tokens: { access_token: "tok-abc", account_id: "acct-123" },
});

/** Builds a layer with the real CodexAuthService over a fake FS keyed by absolute path. */
const makeLayer = (files: Record<string, string>) => {
  const fs = layerNoop({
    exists: (path: string) => Effect.succeed(path in files),
    readFileString: (path: string) =>
      path in files ? Effect.succeed(files[path] as string) : notFound(),
  });
  return Layer.mergeAll(
    CodexAuthService.layer.pipe(Layer.provide(Layer.mergeAll(fs, BunPath.layer))),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME: "/home/u" } })),
  );
};

describe("CodexAuthService.load", () => {
  it.effect("loads token, account id, and version from disk", () =>
    Effect.gen(function* () {
      const auth = yield* CodexAuthService;
      const creds = yield* auth.load;
      expect(Redacted.value(creds.accessToken)).toBe("tok-abc");
      expect(creds.accountId).toBe("acct-123");
      expect(creds.version).toBe("0.150.0");
    }).pipe(
      Effect.provide(
        makeLayer({
          "/home/u/.codex/auth.json": AUTH_JSON,
          "/home/u/.codex/version.json": JSON.stringify({ latest_version: "0.150.0" }),
        }),
      ),
    ),
  );

  it.effect("falls back to FALLBACK_VERSION when version.json is absent", () =>
    Effect.gen(function* () {
      const auth = yield* CodexAuthService;
      const creds = yield* auth.load;
      // FALLBACK_VERSION floor — version.json missing must not fail the load.
      expect(creds.version).toBe("0.142.3");
    }).pipe(Effect.provide(makeLayer({ "/home/u/.codex/auth.json": AUTH_JSON }))),
  );

  it.effect("fails AUTH_MISSING when auth.json is absent", () =>
    Effect.gen(function* () {
      const auth = yield* CodexAuthService;
      const error = yield* Effect.flip(auth.load);
      expect(isImageError(error)).toBe(true);
      expect(error.code).toBe("AUTH_MISSING");
    }).pipe(Effect.provide(makeLayer({}))),
  );

  it.effect("fails AUTH_MISSING when auth.json is malformed", () =>
    Effect.gen(function* () {
      const auth = yield* CodexAuthService;
      const error = yield* Effect.flip(auth.load);
      expect(error.code).toBe("AUTH_MISSING");
    }).pipe(Effect.provide(makeLayer({ "/home/u/.codex/auth.json": "{ not valid json" }))),
  );
});
