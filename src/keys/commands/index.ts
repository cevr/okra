import { Console, Effect, Option, Stream } from "effect";
import { Stdio } from "effect/Stdio";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { envVarForProvider, KeyStoreService } from "../../shared/keystore.js";
import { KeysError } from "../errors.js";

/** The env var that overrides a provider's stored key; unknown providers get an (unset) sentinel. */
const resolveEnvVar = (provider: string): string =>
  envVarForProvider(provider) ?? `OKRA_KEY_${provider.toUpperCase()}`;

/** Map a KeyStoreError into this domain's error (its codes don't overlap 1:1). */
const toKeysError = (e: { code: string; message: string }): KeysError => {
  if (e.code === "INVALID_INPUT") {
    return KeysError.make({ message: e.message, code: "INVALID_INPUT" });
  }
  return KeysError.make({ message: e.message, code: "STORE_FAILED" });
};

/** Human label for where a resolved key came from. */
const describeOrigin = (source: "env" | "stored", provider: string): string => {
  if (source === "env") return `env ${resolveEnvVar(provider)}`;
  return "stored";
};

const providerArgument = Argument.string("provider").pipe(
  Argument.withDescription("Provider name, e.g. openai"),
);

const keyArgument = Argument.string("key").pipe(
  Argument.withDescription("API key value (omit and use --stdin to avoid shell history)"),
  Argument.optional,
);

const stdinFlag = Flag.boolean("stdin").pipe(
  Flag.withDescription("Read the key from stdin instead of an argument"),
);

/** Read all of stdin as text (so the key avoids shell history). */
const readStdin = Effect.gen(function* () {
  const stdio = yield* Stdio;
  return yield* Stream.mkString(Stream.decodeText(stdio.stdin)).pipe(
    Effect.mapError(() =>
      KeysError.make({ message: "Failed to read stdin", code: "INVALID_INPUT" }),
    ),
  );
});

/** `okra keys set <provider> [<key>] [--stdin]` — store a key. Never echoes the value. */
const setCommand = Command.make(
  "set",
  { provider: providerArgument, key: keyArgument, stdin: stdinFlag },
  ({ provider, key, stdin }) =>
    Effect.gen(function* () {
      const keyStore = yield* KeyStoreService;

      // --stdin reads the key off the pipe; otherwise it must come from the argument.
      const readKey = (): Effect.Effect<string, KeysError, Stdio> => {
        if (stdin) return readStdin;
        return Effect.fromOption(key).pipe(
          Effect.mapError(() =>
            KeysError.make({
              message: "No key provided. Pass it as an argument or pipe it with --stdin.",
              code: "INVALID_INPUT",
            }),
          ),
        );
      };
      const raw = yield* readKey();

      const file = yield* keyStore.store(provider, raw).pipe(Effect.mapError(toKeysError));
      // Never echo the key; only confirm where it was written.
      yield* Console.error(`Saved "${provider}" key to ${file}`);
    }),
).pipe(Command.withDescription("Store an API key for a provider"));

/** `okra keys list` — print stored provider names (never the values), one per line on stdout. */
const listCommand = Command.make("list", {}, () =>
  Effect.gen(function* () {
    const keyStore = yield* KeyStoreService;
    const names = yield* keyStore.list.pipe(Effect.mapError(toKeysError));
    if (names.length === 0) {
      yield* Console.error("No keys stored. Add one with `okra keys set <provider> <key>`.");
      return;
    }
    // Names only — values are never read here. stdout so the list is pipeable.
    yield* Console.log(names.join("\n"));
  }),
).pipe(Command.withDescription("List provider names that have a stored key"));

/**
 * `okra keys get <provider>` — report whether a key is configured and where it
 * resolves from, with a masked preview. Never prints the secret.
 */
const getCommand = Command.make("get", { provider: providerArgument }, ({ provider }) =>
  Effect.gen(function* () {
    const keyStore = yield* KeyStoreService;
    const status = yield* keyStore
      .describe(provider, resolveEnvVar(provider))
      .pipe(Effect.mapError(toKeysError));

    if (status.source === "missing") {
      return yield* KeysError.make({
        message: `No key for "${provider}". Set ${resolveEnvVar(provider)} or run \`okra keys set ${provider}\`.`,
        code: "NOT_FOUND",
      });
    }

    const masked = Option.getOrElse(status.masked, () => "");
    const origin = describeOrigin(status.source, provider);
    // Masked preview + origin on stdout — capturable, reveals nothing.
    yield* Console.log(`${masked} (${origin})`);
  }),
).pipe(Command.withDescription("Show whether a provider's key is set (masked), and its source"));

/** `okra keys rm <provider>` — remove a stored key. */
const removeCommand = Command.make("rm", { provider: providerArgument }, ({ provider }) =>
  Effect.gen(function* () {
    const keyStore = yield* KeyStoreService;
    const removed = yield* keyStore.remove(provider).pipe(Effect.mapError(toKeysError));
    if (!removed) {
      return yield* KeysError.make({
        message: `No stored key for "${provider}".`,
        code: "NOT_FOUND",
      });
    }
    yield* Console.error(`Removed "${provider}" key.`);
  }),
).pipe(Command.withDescription("Remove a stored API key"));

const root = Command.make("keys", {}, () => Effect.void).pipe(
  Command.withDescription("Manage stored API keys in ~/.okra/keys.json"),
);

export const keysRoot = root.pipe(
  Command.withSubcommands([setCommand, listCommand, getCommand, removeCommand]),
);
