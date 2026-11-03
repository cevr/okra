import { Effect, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

const IN_PROGRESS = `"status":"in_progress"`;
const GENERATING_RE = /"status"\s*:\s*"generating"/g;

export const makeCodexStatusTransform = (): TransformStream<Uint8Array, Uint8Array> => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const rewrite = (event: string): string => {
    if (event.includes(`"generating"`)) return event.replace(GENERATING_RE, IN_PROGRESS);
    return event;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let sep = buffer.indexOf("\n\n");
      while (sep !== -1) {
        const event = buffer.slice(0, sep + 2);
        buffer = buffer.slice(sep + 2);
        controller.enqueue(encoder.encode(rewrite(event)));
        sep = buffer.indexOf("\n\n");
      }
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        controller.enqueue(encoder.encode(rewrite(buffer)));
        buffer = "";
      }
    },
  });
};

const patchResponse = (
  response: HttpClientResponse.HttpClientResponse,
): HttpClientResponse.HttpClientResponse => {
  const patchedBody = Stream.toReadableStream(response.stream).pipeThrough(
    makeCodexStatusTransform(),
  );
  const webResponse = new Response(patchedBody, {
    status: response.status,
    headers: response.headers,
  });
  return HttpClientResponse.fromWeb(response.request, webResponse);
};

export const withCodexStreamPatch = (client: HttpClient.HttpClient): HttpClient.HttpClient =>
  HttpClient.transformResponse(client, Effect.map(patchResponse));
