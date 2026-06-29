import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";

/** Path (relative to home) of the shared, multi-provider key store. */
export const KEYS_RELATIVE_PATH = ".okra/keys.json";

/**
 * Known provider → overriding env var. Used by `okra keys` to report/resolve the
 * ambient override for a provider. Unknown providers have no env override.
 */
export const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
};

/** The env var that overrides a provider's stored key, or `undefined` if none is known. */
export const envVarForProvider = (name: string): string | undefined => PROVIDER_ENV_VARS[name];

/** Failure reading, parsing, or writing the key store. Domains map this to their own error. */
export class KeyStoreError extends Schema.TaggedErrorClass<KeyStoreError>()(
  "@cvr/okra/shared/KeyStoreError",
  { message: Schema.String, code: Schema.Literals(["MISSING", "WRITE_FAILED", "INVALID_INPUT"]) },
) {}

/** `~/.okra/keys.json` is a flat map of provider name → secret, e.g. `{ "openai": "sk-..." }`. */
const KeysFile = Schema.Record(Schema.String, Schema.String);
const decodeKeysFile = Schema.decodeUnknownEffect(Schema.fromJsonString(KeysFile));
const encodeKeysFile = Schema.encodeEffect(Schema.fromJsonString(KeysFile));

/** Where a resolved key comes from (or that none exists), plus a non-revealing preview. */
export interface KeyStatus {
  readonly source: "env" | "stored" | "missing";
  /** Masked preview like `sk-…a1b2`; `None` when `source` is `"missing"`. */
  readonly masked: Option.Option<string>;
}

/**
 * Mask a secret to a non-revealing preview: a short visible prefix and the last
 * four characters, e.g. `sk-pr…a1b2`. Short secrets collapse to all-bullets so
 * nothing meaningful leaks.
 */
export const maskSecret = (secret: string): string => {
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 5)}…${secret.slice(-4)}`;
};

/**
 * A generic, cross-domain secret store backed by `~/.okra/keys.json`. Keys are
 * addressed by a provider `name` (e.g. `"openai"`). Resolution lets an ambient
 * environment variable override the stored value: **env > stored**.
 *
 * Not OpenAI-specific — any domain needing a persisted API key can depend on it.
 */
export class KeyStoreService extends Context.Service<
  KeyStoreService,
  {
    /**
     * Resolve the secret for `name`. If `envVar` is set in the environment it
     * wins; otherwise the stored value is used. Fails MISSING if neither exists.
     */
    readonly resolve: (
      name: string,
      envVar: string,
    ) => Effect.Effect<Redacted.Redacted<string>, KeyStoreError>;
    /** Persist `key` under `name` in `~/.okra/keys.json` (created 0600). Returns the path written. */
    readonly store: (name: string, key: string) => Effect.Effect<string, KeyStoreError>;
    /** The provider names that have a stored key (sorted). Never returns the secret values. */
    readonly list: Effect.Effect<ReadonlyArray<string>, KeyStoreError>;
    /** Remove the stored key for `name`. Returns `true` if a key was removed, `false` if absent. */
    readonly remove: (name: string) => Effect.Effect<boolean, KeyStoreError>;
    /**
     * Report where `name` resolves from and a masked preview — without exposing
     * the secret. `source` follows the same **env > stored** precedence as
     * `resolve`; `masked` is `None` only when `source` is `"missing"`.
     */
    readonly describe: (name: string, envVar: string) => Effect.Effect<KeyStatus, KeyStoreError>;
  }
>()("@cvr/okra/shared/keystore/KeyStoreService") {
  static layer: Layer.Layer<KeyStoreService, never, FileSystem | Path> = Layer.effect(
    KeyStoreService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      const keysPath = Config.string("HOME").pipe(
        Effect.mapError(
          () =>
            new KeyStoreError({ message: "HOME environment variable is not set", code: "MISSING" }),
        ),
        Effect.map((home) => path.join(home, KEYS_RELATIVE_PATH)),
      );

      const readAll = Effect.gen(function* () {
        const file = yield* keysPath;
        const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
        if (!exists) return {} as Record<string, string>;
        const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
        // A malformed file is treated as empty rather than fatal.
        return yield* decodeKeysFile(text).pipe(
          Effect.orElseSucceed(() => ({}) as Record<string, string>),
        );
      });

      const resolve = Effect.fn("KeyStore.resolve")(function* (name: string, envVar: string) {
        // Ambient env wins over the stored value.
        const fromEnv = yield* Config.option(Config.string(envVar)).pipe(
          Effect.orElseSucceed(() => Option.none<string>()),
        );
        if (Option.isSome(fromEnv)) return Redacted.make(fromEnv.value);
        const all = yield* readAll;
        const stored = all[name];
        if (stored === undefined || stored.length === 0) {
          return yield* new KeyStoreError({
            message: `No key for "${name}". Set ${envVar} or store one.`,
            code: "MISSING",
          });
        }
        return Redacted.make(stored);
      });

      // Persist the whole map (0600), creating the directory if needed. Returns the path.
      const writeAll = Effect.fn("KeyStore.writeAll")(function* (map: Record<string, string>) {
        const file = yield* keysPath;
        const dir = path.dirname(file);
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(
          Effect.mapError(
            (e) =>
              new KeyStoreError({
                message: `Cannot create ${dir}: ${e.message}`,
                code: "WRITE_FAILED",
              }),
          ),
        );
        const text = yield* encodeKeysFile(map).pipe(
          Effect.mapError(
            () =>
              new KeyStoreError({ message: "Failed to serialize key store", code: "WRITE_FAILED" }),
          ),
        );
        yield* fs.writeFileString(file, `${text}\n`).pipe(
          Effect.mapError(
            (e) =>
              new KeyStoreError({
                message: `Cannot write ${file}: ${e.message}`,
                code: "WRITE_FAILED",
              }),
          ),
        );
        // Restrict to the owner — the file holds secrets.
        yield* fs.chmod(file, 0o600).pipe(Effect.catch(() => Effect.void));
        return file;
      });

      const store = Effect.fn("KeyStore.store")(function* (name: string, key: string) {
        const trimmed = key.trim();
        if (trimmed.length === 0) {
          return yield* new KeyStoreError({ message: "Key is empty", code: "INVALID_INPUT" });
        }
        // Merge into the existing map so storing one provider keeps the others.
        const current = yield* readAll;
        return yield* writeAll({ ...current, [name]: trimmed });
      });

      const list = readAll.pipe(Effect.map((all) => Object.keys(all).sort()));

      const remove = Effect.fn("KeyStore.remove")(function* (name: string) {
        const current = yield* readAll;
        if (!(name in current)) return false;
        const { [name]: _removed, ...rest } = current;
        yield* writeAll(rest);
        return true;
      });

      const describe = Effect.fn("KeyStore.describe")(function* (name: string, envVar: string) {
        // Mirror resolve()'s precedence so the report matches what consumers use.
        const fromEnv = yield* Config.option(Config.string(envVar)).pipe(
          Effect.orElseSucceed(() => Option.none<string>()),
        );
        if (Option.isSome(fromEnv) && fromEnv.value.length > 0) {
          return {
            source: "env",
            masked: Option.some(maskSecret(fromEnv.value)),
          } satisfies KeyStatus;
        }
        const all = yield* readAll;
        const stored = all[name];
        if (stored !== undefined && stored.length > 0) {
          return { source: "stored", masked: Option.some(maskSecret(stored)) } satisfies KeyStatus;
        }
        return { source: "missing", masked: Option.none() } satisfies KeyStatus;
      });

      return { resolve, store, list, remove, describe };
    }),
  );

  static layerTest = (
    keys: Record<string, string>,
    env: Record<string, string> = {},
  ): Layer.Layer<KeyStoreService> =>
    Layer.succeed(KeyStoreService, {
      resolve: (name, envVar) => {
        const value = env[envVar] ?? keys[name];
        return value === undefined
          ? Effect.fail(new KeyStoreError({ message: `No key for "${name}".`, code: "MISSING" }))
          : Effect.succeed(Redacted.make(value));
      },
      store: () => Effect.succeed("/test/.okra/keys.json"),
      list: Effect.succeed(Object.keys(keys).sort()),
      remove: (name) => Effect.succeed(name in keys),
      describe: (name, envVar) => {
        const fromEnv = env[envVar];
        if (fromEnv !== undefined && fromEnv.length > 0) {
          return Effect.succeed({ source: "env", masked: Option.some(maskSecret(fromEnv)) });
        }
        const stored = keys[name];
        return Effect.succeed(
          stored !== undefined && stored.length > 0
            ? { source: "stored", masked: Option.some(maskSecret(stored)) }
            : { source: "missing", masked: Option.none() },
        );
      },
    });
}
