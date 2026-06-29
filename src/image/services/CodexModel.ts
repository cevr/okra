import { Effect, Layer, Random } from "effect";
import type { LanguageModel } from "effect/unstable/ai";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { HttpClientError, TransportError } from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { CODEX_API_URL, ORIGINATOR } from "../constants.js";
import { CodexAuthService } from "./CodexAuth.js";
import { withCodexStreamPatch } from "./CodexStreamPatch.js";

/**
 * Builds a `LanguageModel` layer pointed at the ChatGPT "codex" Responses
 * backend, authenticated with the OAuth token from `~/.codex/auth.json`.
 *
 * Auth is read per request (via `mapRequestEffect`) rather than baked in at
 * layer construction, so the freshest token on disk is always used and a token
 * read failure surfaces as the request's error channel.
 */
export const codexModelLayer = (
  model: string,
): Layer.Layer<LanguageModel.LanguageModel, never, CodexAuthService | HttpClient.HttpClient> => {
  const clientLayer = Layer.effect(
    OpenAiClient.OpenAiClient,
    Effect.gen(function* () {
      const auth = yield* CodexAuthService;
      // One stable session id per model layer, mirroring the codex CLI's reuse.
      const sessionId = (yield* Random.next).toString(16).slice(2).padEnd(16, "0");

      // Inject codex auth headers per request. Applied to the client the provider
      // hands us (which already prepends `apiUrl` and sets Accept: application/json),
      // so we must transform that client rather than replace it. The stream patch
      // then rewrites the codex-only `"generating"` image status the upstream SSE
      // schema rejects.
      const transformClient = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
        withCodexStreamPatch(client).pipe(
          HttpClient.mapRequestEffect((request) =>
            auth.load.pipe(
              Effect.map((creds) =>
                request.pipe(
                  HttpClientRequest.bearerToken(creds.accessToken),
                  HttpClientRequest.setHeader("chatgpt-account-id", creds.accountId),
                  HttpClientRequest.setHeader("originator", ORIGINATOR),
                  // The backend rejects requests without a current codex version.
                  HttpClientRequest.setHeader("version", creds.version),
                  HttpClientRequest.setHeader("session_id", sessionId),
                  HttpClientRequest.setHeader(
                    "User-Agent",
                    `${ORIGINATOR}/${creds.version} (okra)`,
                  ),
                ),
              ),
              // Surface a missing/unreadable token as a transport error so the
              // client's error channel stays HttpClientError. In practice the
              // command pre-checks credentials (see image/commands), so this only
              // fires if the token disappears mid-flight; the original ImageError
              // is kept as `cause` for diagnostics.
              Effect.mapError(
                (cause) =>
                  new HttpClientError({
                    reason: new TransportError({ request, cause, description: cause.message }),
                  }),
              ),
            ),
          ),
        );

      return yield* OpenAiClient.make({
        apiUrl: CODEX_API_URL,
        transformClient,
      });
    }),
  );

  // The codex backend rejects requests unless `store` is false.
  return OpenAiLanguageModel.layer({ model, config: { store: false } }).pipe(
    Layer.provide(clientLayer),
  );
};
