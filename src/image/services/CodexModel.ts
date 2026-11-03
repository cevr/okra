import { Effect, Layer, Random } from "effect";
import type { LanguageModel } from "effect/ai";
import * as HttpClient from "effect/http/HttpClient";
import { HttpClientError, TransportError } from "effect/http/HttpClientError";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai";
import { CODEX_API_URL, ORIGINATOR } from "../constants.js";
import { CodexAuthService } from "./CodexAuth.js";
import { withCodexStreamPatch } from "./CodexStreamPatch.js";

const CODEX_BACKEND_REQUIRED_CONFIG = { store: false };

export const codexModelLayer = (
  model: string,
): Layer.Layer<LanguageModel.LanguageModel, never, CodexAuthService | HttpClient.HttpClient> => {
  const clientLayer = Layer.effect(
    OpenAiClient.OpenAiClient,
    Effect.gen(function* () {
      const auth = yield* CodexAuthService;
      const sessionId = (yield* Random.next).toString(16).slice(2).padEnd(16, "0");

      const transformClient = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
        withCodexStreamPatch(client).pipe(
          HttpClient.mapRequestEffect((request) =>
            auth.load.pipe(
              Effect.map((creds) =>
                request.pipe(
                  HttpClientRequest.bearerToken(creds.accessToken),
                  HttpClientRequest.setHeader("chatgpt-account-id", creds.accountId),
                  HttpClientRequest.setHeader("originator", ORIGINATOR),
                  HttpClientRequest.setHeader("version", creds.version),
                  HttpClientRequest.setHeader("session_id", sessionId),
                  HttpClientRequest.setHeader(
                    "User-Agent",
                    `${ORIGINATOR}/${creds.version} (okra)`,
                  ),
                ),
              ),
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

  return OpenAiLanguageModel.layer({ model, config: CODEX_BACKEND_REQUIRED_CONFIG }).pipe(
    Layer.provide(clientLayer),
  );
};
