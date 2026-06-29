import { ConfigProvider, Effect, Layer, Option, Redacted, Ref } from "effect";
import { layerNoop } from "effect/FileSystem";
import { PlatformError, SystemError } from "effect/PlatformError";
import * as BunPath from "@effect/platform-bun/BunPath";
import { describe, expect, it } from "effect-bun-test";
import { KeyStoreError, KeyStoreService, maskSecret } from "../../src/shared/keystore.js";

const ENV_VAR = "OPENAI_API_KEY";
const KEYS_PATH = "/home/u/.okra/keys.json";

const notFound = () =>
  Effect.fail(
    new PlatformError(
      new SystemError({ _tag: "NotFound", module: "FileSystem", method: "readFileString" }),
    ),
  );

/** A fake FS backed by an in-memory map, so `store` is observable and `resolve` reads it back. */
const makeLayer = (initial: Record<string, string>, envOverrides: Record<string, string>) =>
  Effect.gen(function* () {
    // HOME is always present; resolution env vars are layered on top per test.
    const env = { HOME: "/home/u", ...envOverrides };
    const files = yield* Ref.make<Record<string, string>>(initial);
    const fs = layerNoop({
      exists: (path: string) => Effect.map(Ref.get(files), (f) => path in f),
      readFileString: (path: string) =>
        Effect.flatMap(Ref.get(files), (f) =>
          path in f ? Effect.succeed(f[path] as string) : notFound(),
        ),
      writeFileString: (path: string, content: string) =>
        Ref.update(files, (f) => ({ ...f, [path]: content })),
      makeDirectory: () => Effect.void,
      chmod: () => Effect.void,
    });
    const layer = Layer.mergeAll(
      KeyStoreService.layer.pipe(Layer.provide(Layer.mergeAll(fs, BunPath.layer))),
      ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
    );
    return { layer, files };
  });

describe("KeyStoreService.resolve", () => {
  it.effect("prefers the ambient env var over the stored key", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer(
        { [KEYS_PATH]: `{"openai":"sk-stored"}` },
        { OPENAI_API_KEY: "sk-env" },
      );
      const key = yield* Effect.flatMap(KeyStoreService, (s) => s.resolve("openai", ENV_VAR)).pipe(
        Effect.provide(layer),
      );
      expect(Redacted.value(key)).toBe("sk-env");
    }),
  );

  it.effect("falls back to the stored key when env is unset", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({ [KEYS_PATH]: `{"openai":"sk-stored"}` }, {});
      const key = yield* Effect.flatMap(KeyStoreService, (s) => s.resolve("openai", ENV_VAR)).pipe(
        Effect.provide(layer),
      );
      expect(Redacted.value(key)).toBe("sk-stored");
    }),
  );

  it.effect("resolves keys independently by name", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer(
        { [KEYS_PATH]: `{"openai":"sk-a","anthropic":"sk-b"}` },
        {},
      );
      const anthropic = yield* Effect.flatMap(KeyStoreService, (s) =>
        s.resolve("anthropic", "ANTHROPIC_API_KEY"),
      ).pipe(Effect.provide(layer));
      expect(Redacted.value(anthropic)).toBe("sk-b");
    }),
  );

  it.effect("fails MISSING when neither env nor a stored key exists", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({}, {});
      const err = yield* Effect.flip(
        Effect.flatMap(KeyStoreService, (s) => s.resolve("openai", ENV_VAR)).pipe(
          Effect.provide(layer),
        ),
      );
      expect(err).toBeInstanceOf(KeyStoreError);
      expect(err.code).toBe("MISSING");
    }),
  );
});

describe("KeyStoreService.store", () => {
  it.effect("persists the key, then resolve reads it back (trimmed)", () =>
    Effect.gen(function* () {
      const { layer, files } = yield* makeLayer({}, {});
      yield* Effect.gen(function* () {
        const store = yield* KeyStoreService;
        const path = yield* store.store("openai", "  sk-fresh  ");
        expect(path).toBe(KEYS_PATH);
        const key = yield* store.resolve("openai", ENV_VAR);
        expect(Redacted.value(key)).toBe("sk-fresh");
      }).pipe(Effect.provide(layer));
      const written = yield* Ref.get(files);
      expect(written[KEYS_PATH]).toContain("sk-fresh");
    }),
  );

  it.effect("merges into the existing map, preserving other providers", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({ [KEYS_PATH]: `{"anthropic":"sk-keep"}` }, {});
      yield* Effect.gen(function* () {
        const store = yield* KeyStoreService;
        yield* store.store("openai", "sk-new");
        const openai = yield* store.resolve("openai", ENV_VAR);
        const anthropic = yield* store.resolve("anthropic", "ANTHROPIC_API_KEY");
        expect(Redacted.value(openai)).toBe("sk-new");
        expect(Redacted.value(anthropic)).toBe("sk-keep"); // not clobbered
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("rejects an empty key", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({}, {});
      const err = yield* Effect.flip(
        Effect.flatMap(KeyStoreService, (s) => s.store("openai", "   ")).pipe(
          Effect.provide(layer),
        ),
      );
      expect(err.code).toBe("INVALID_INPUT");
    }),
  );
});

describe("KeyStoreService.list", () => {
  it.effect("returns the stored provider names, sorted", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer(
        { [KEYS_PATH]: `{"openai":"sk-a","anthropic":"sk-b"}` },
        {},
      );
      const names = yield* Effect.flatMap(KeyStoreService, (s) => s.list).pipe(
        Effect.provide(layer),
      );
      expect(names).toEqual(["anthropic", "openai"]); // sorted, names only
    }),
  );

  it.effect("returns an empty list when no keys are stored", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({}, {});
      const names = yield* Effect.flatMap(KeyStoreService, (s) => s.list).pipe(
        Effect.provide(layer),
      );
      expect(names).toEqual([]);
    }),
  );
});

describe("KeyStoreService.remove", () => {
  it.effect("removes a stored key and reports true, leaving others intact", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer(
        { [KEYS_PATH]: `{"openai":"sk-a","anthropic":"sk-b"}` },
        {},
      );
      yield* Effect.gen(function* () {
        const store = yield* KeyStoreService;
        const removed = yield* store.remove("openai");
        expect(removed).toBe(true);
        const names = yield* store.list;
        expect(names).toEqual(["anthropic"]); // openai gone, anthropic kept
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect("reports false when the key is absent", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({ [KEYS_PATH]: `{"openai":"sk-a"}` }, {});
      const removed = yield* Effect.flatMap(KeyStoreService, (s) => s.remove("nope")).pipe(
        Effect.provide(layer),
      );
      expect(removed).toBe(false);
    }),
  );
});

describe("maskSecret", () => {
  it.effect("masks a normal key to prefix…last4, never revealing the middle", () =>
    Effect.sync(() => {
      expect(maskSecret("sk-proj-abcdefghijklmnop1234")).toBe("sk-pr…1234");
    }),
  );

  it.effect("collapses short secrets to all bullets", () =>
    Effect.sync(() => {
      expect(maskSecret("short")).toBe("•••••");
      expect(maskSecret("12345678")).toBe("••••••••"); // boundary: 8 chars
    }),
  );
});

describe("KeyStoreService.describe", () => {
  it.effect("reports source=env (masked) when the env var is set", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer(
        { [KEYS_PATH]: `{"openai":"sk-stored-value-xyz"}` },
        { OPENAI_API_KEY: "sk-env-value-abcd1234" },
      );
      const status = yield* Effect.flatMap(KeyStoreService, (s) =>
        s.describe("openai", ENV_VAR),
      ).pipe(Effect.provide(layer));
      expect(status.source).toBe("env");
      expect(Option.getOrThrow(status.masked)).toBe(maskSecret("sk-env-value-abcd1234"));
    }),
  );

  it.effect("reports source=stored (masked) when only the stored key exists", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({ [KEYS_PATH]: `{"openai":"sk-stored-value-xyz"}` }, {});
      const status = yield* Effect.flatMap(KeyStoreService, (s) =>
        s.describe("openai", ENV_VAR),
      ).pipe(Effect.provide(layer));
      expect(status.source).toBe("stored");
      expect(Option.getOrThrow(status.masked)).toBe(maskSecret("sk-stored-value-xyz"));
    }),
  );

  it.effect("reports source=missing with no preview when neither exists", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeLayer({}, {});
      const status = yield* Effect.flatMap(KeyStoreService, (s) =>
        s.describe("openai", ENV_VAR),
      ).pipe(Effect.provide(layer));
      expect(status.source).toBe("missing");
      expect(Option.isNone(status.masked)).toBe(true);
    }),
  );
});
