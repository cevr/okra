import { Config, Context, Effect, Layer, Redacted, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { AUTH_RELATIVE_PATH, FALLBACK_VERSION, VERSION_RELATIVE_PATH } from "../constants.js";
import { ImageError } from "../errors.js";

/**
 * Shape of `~/.codex/auth.json`. Only the `tokens` block is load-bearing; other
 * keys (auth_mode, OPENAI_API_KEY, last_refresh) are ignored.
 */
const CodexAuthFile = Schema.Struct({
  tokens: Schema.Struct({
    access_token: Schema.String,
    account_id: Schema.String,
  }),
});

const decodeAuthFile = Schema.decodeUnknownEffect(Schema.fromJsonString(CodexAuthFile));

/** Shape of `~/.codex/version.json` — only `latest_version` is used. */
const CodexVersionFile = Schema.Struct({
  latest_version: Schema.optionalKey(Schema.NullishOr(Schema.String)),
});
const decodeVersionFile = Schema.decodeUnknownEffect(Schema.fromJsonString(CodexVersionFile));

export interface CodexCredentials {
  /** OAuth access token for the Authorization: Bearer header. Redacted to avoid leaks in logs. */
  readonly accessToken: Redacted.Redacted<string>;
  /** Value for the chatgpt-account-id header. */
  readonly accountId: string;
  /** Codex CLI version for the `version` header; the backend rejects stale versions. */
  readonly version: string;
}

/**
 * Loads ChatGPT/codex OAuth credentials from `~/.codex/auth.json`, the file
 * `codex login` writes. We do not run our own OAuth flow or refresh tokens — on
 * a rejected token the caller surfaces an AUTH_EXPIRED error telling the user to
 * re-run `codex login`.
 */
export class CodexAuthService extends Context.Service<
  CodexAuthService,
  {
    readonly load: Effect.Effect<CodexCredentials, ImageError>;
  }
>()("@cvr/okra/image/services/CodexAuth/CodexAuthService") {
  static layer: Layer.Layer<CodexAuthService, never, FileSystem | Path> = Layer.effect(
    CodexAuthService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      const resolveHome = Config.string("HOME").pipe(
        Effect.mapError(
          () =>
            new ImageError({
              message: "HOME environment variable is not set",
              code: "AUTH_MISSING",
            }),
        ),
      );

      // Best-effort: read the codex CLI version, falling back to FALLBACK_VERSION
      // when version.json is missing or unparseable. Never fails the load.
      const readVersion = (home: string) =>
        fs.readFileString(path.join(home, VERSION_RELATIVE_PATH)).pipe(
          Effect.flatMap(decodeVersionFile),
          Effect.map((file) => file.latest_version ?? FALLBACK_VERSION),
          Effect.orElseSucceed(() => FALLBACK_VERSION),
        );

      const load = Effect.gen(function* () {
        const home = yield* resolveHome;
        const authPath = path.join(home, AUTH_RELATIVE_PATH);

        const exists = yield* fs.exists(authPath).pipe(Effect.orElseSucceed(() => false));
        if (!exists) {
          return yield* new ImageError({
            message: `No codex credentials at ${authPath}. Run \`codex login\` first.`,
            code: "AUTH_MISSING",
          });
        }

        const text = yield* fs.readFileString(authPath).pipe(
          Effect.mapError(
            () =>
              new ImageError({
                message: `Cannot read ${authPath}. Run \`codex login\` to refresh credentials.`,
                code: "AUTH_MISSING",
              }),
          ),
        );

        const parsed = yield* decodeAuthFile(text).pipe(
          Effect.mapError(
            () =>
              new ImageError({
                message: `Malformed codex credentials at ${authPath}. Run \`codex login\` again.`,
                code: "AUTH_MISSING",
              }),
          ),
        );

        const version = yield* readVersion(home);

        return {
          accessToken: Redacted.make(parsed.tokens.access_token),
          accountId: parsed.tokens.account_id,
          version,
        } satisfies CodexCredentials;
      });

      return { load };
    }),
  );

  static layerTest = (credentials: CodexCredentials): Layer.Layer<CodexAuthService> =>
    Layer.succeed(CodexAuthService, { load: Effect.succeed(credentials) });
}
