import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";

export const KEYS_RELATIVE_PATH = ".okra/keys.json";

export const PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
};

export const envVarForProvider = (name: string): string | undefined => PROVIDER_ENV_VARS[name];

export class KeyStoreError extends Schema.TaggedError<
  KeyStoreError,
  { readonly brand: unique symbol }
>()("@cvr/okra/shared/KeyStoreError", {
  message: Schema.String,
  code: Schema.Literals(["MISSING", "WRITE_FAILED", "INVALID_INPUT"]),
}) {}

const KeysFile = Schema.Record(Schema.String, Schema.String);
const decodeKeysFile = Schema.decodeUnknownEffect(Schema.fromJsonString(KeysFile));
const encodeKeysFile = Schema.encodeEffect(Schema.fromJsonString(KeysFile));

export interface KeyStatus {
  readonly source: "env" | "stored" | "missing";
  readonly masked: Option.Option<string>;
}

export const maskSecret = (secret: string): string => {
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 5)}…${secret.slice(-4)}`;
};

export class KeyStoreService extends Context.Service<
  KeyStoreService,
  {
    readonly resolve: (
      name: string,
      envVar: string,
    ) => Effect.Effect<Redacted.Redacted<string>, KeyStoreError>;
    readonly store: (name: string, key: string) => Effect.Effect<string, KeyStoreError>;
    readonly list: Effect.Effect<ReadonlyArray<string>, KeyStoreError>;
    readonly remove: (name: string) => Effect.Effect<boolean, KeyStoreError>;
    readonly describe: (name: string, envVar: string) => Effect.Effect<KeyStatus, KeyStoreError>;
  }
>()("@cvr/okra/shared/keystore/KeyStoreService") {
  static layer: Layer.Layer<KeyStoreService, never, FileSystem | Path> = Layer.effect(
    KeyStoreService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      const keysPath = Config.String("HOME").pipe(
        Effect.mapError(() =>
          KeyStoreError.make({ message: "HOME environment variable is not set", code: "MISSING" }),
        ),
        Effect.map((home) => path.join(home, KEYS_RELATIVE_PATH)),
      );

      const readAll = Effect.gen(function* () {
        const file = yield* keysPath;
        const exists = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
        if (!exists) return {} as Record<string, string>;
        const text = yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
        return yield* decodeKeysFile(text).pipe(
          Effect.orElseSucceed(() => ({}) as Record<string, string>),
        );
      });

      const resolve = Effect.fn("KeyStore.resolve")(function* (name: string, envVar: string) {
        const fromEnv = yield* Config.option(Config.String(envVar)).pipe(
          Effect.orElseSucceed(() => Option.none<string>()),
        );
        if (Option.isSome(fromEnv)) return Redacted.make(fromEnv.value);
        const all = yield* readAll;
        const stored = all[name];
        if (stored === undefined || stored.length === 0) {
          return yield* KeyStoreError.make({
            message: `No key for "${name}". Set ${envVar} or store one.`,
            code: "MISSING",
          });
        }
        return Redacted.make(stored);
      });

      const writeAll = Effect.fn("KeyStore.writeAll")(function* (map: Record<string, string>) {
        const file = yield* keysPath;
        const dir = path.dirname(file);
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(
          Effect.mapError((e) =>
            KeyStoreError.make({
              message: `Cannot create ${dir}: ${e.message}`,
              code: "WRITE_FAILED",
            }),
          ),
        );
        const text = yield* encodeKeysFile(map).pipe(
          Effect.mapError(() =>
            KeyStoreError.make({ message: "Failed to serialize key store", code: "WRITE_FAILED" }),
          ),
        );
        yield* fs.writeFileString(file, `${text}\n`).pipe(
          Effect.mapError((e) =>
            KeyStoreError.make({
              message: `Cannot write ${file}: ${e.message}`,
              code: "WRITE_FAILED",
            }),
          ),
        );
        yield* fs.chmod(file, 0o600).pipe(Effect.ignore);
        return file;
      });

      const store = Effect.fn("KeyStore.store")(function* (name: string, key: string) {
        const trimmed = key.trim();
        if (trimmed.length === 0) {
          return yield* KeyStoreError.make({ message: "Key is empty", code: "INVALID_INPUT" });
        }
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
        const fromEnv = yield* Config.option(Config.String(envVar)).pipe(
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
        if (value === undefined) {
          return Effect.fail(
            KeyStoreError.make({ message: `No key for "${name}".`, code: "MISSING" }),
          );
        }
        return Effect.succeed(Redacted.make(value));
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
        if (stored !== undefined && stored.length > 0) {
          return Effect.succeed({ source: "stored", masked: Option.some(maskSecret(stored)) });
        }
        return Effect.succeed({ source: "missing", masked: Option.none() });
      },
    });
}
