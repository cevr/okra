import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { HttpBody, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { Generated } from "@effect/ai-openai";
import { KeyStoreService } from "../../shared/keystore.js";
import {
  IMAGE_QUALITY_CHOICES,
  OPENAI_API_KEY_ENV,
  OPENAI_API_URL,
  OPENAI_KEY_NAME,
} from "../constants.js";
import { ImageError } from "../errors.js";
import type { ImageFormat, ImageQuality } from "./ImageGen.js";

export interface OpenAiImageInput {
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
  readonly format: ImageFormat;
  readonly quality?: ImageQuality;
  readonly background?: "transparent" | "opaque" | "auto";
  readonly n?: number;
}

export interface ImagePart {
  readonly data: Uint8Array;
  readonly mediaType: string;
}

export interface OpenAiEditInput {
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
  readonly format: ImageFormat;
  readonly images: ReadonlyArray<ImagePart>;
  readonly mask?: ImagePart;
  readonly quality?: ImageQuality;
  readonly background?: "transparent" | "opaque" | "auto";
  readonly n?: number;
  readonly inputFidelity?: "high" | "low";
}

const CreateImageRequest = Schema.Struct({
  ...Generated.CreateImageRequest.fields,
  quality: Schema.optionalKey(Schema.Literals(IMAGE_QUALITY_CHOICES)),
});
const encodeImageRequest = HttpClientRequest.schemaBodyJson(CreateImageRequest);

const ImagesResponse = Schema.Struct({
  ...Generated.ImagesResponse.fields,
  quality: Schema.optionalKey(Schema.Literals(IMAGE_QUALITY_CHOICES)),
  size: Schema.optionalKey(Schema.String),
});
const decodeImagesResponse = HttpClientResponse.schemaBodyJson(ImagesResponse);

const extForMedia = (mediaType: string): string => {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  return "png";
};

const omitUndefined = <T extends object>(fields: T): Partial<T> => {
  const kept: Partial<T> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) kept[name as keyof T] = value as T[keyof T];
  }
  return kept;
};

const formImageKey = (imageCount: number): string => {
  if (imageCount > 1) return "image[]";
  return "image";
};

const toBlob = (part: ImagePart, name: string): globalThis.File => {
  const buffer = new Uint8Array(part.data.length);
  buffer.set(part.data);
  return new globalThis.File([buffer], `${name}.${extForMedia(part.mediaType)}`, {
    type: part.mediaType,
  });
};

export class OpenAiImagesService extends Context.Service<
  OpenAiImagesService,
  {
    readonly generate: (
      input: OpenAiImageInput,
    ) => Effect.Effect<ReadonlyArray<Uint8Array>, ImageError>;
    readonly edit: (input: OpenAiEditInput) => Effect.Effect<ReadonlyArray<Uint8Array>, ImageError>;
  }
>()("@cvr/okra/image/services/OpenAiImages/OpenAiImagesService") {
  static layer: Layer.Layer<OpenAiImagesService, never, HttpClient.HttpClient | KeyStoreService> =
    Layer.effect(
      OpenAiImagesService,
      Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient;
        const keyStore = yield* KeyStoreService;

        const apiKey = keyStore.resolve(OPENAI_KEY_NAME, OPENAI_API_KEY_ENV).pipe(
          Effect.mapError(() =>
            ImageError.make({
              message: `No OpenAI API key. Set ${OPENAI_API_KEY_ENV} or run \`okra keys set openai\`.`,
              code: "AUTH_MISSING",
            }),
          ),
        );

        const runImages = Effect.fn("OpenAiImages.run")(function* (
          request: HttpClientRequest.HttpClientRequest,
          model: string,
          verb: string,
        ) {
          const httpResponse = yield* httpClient.execute(request).pipe(
            Effect.mapError((cause) =>
              ImageError.make({
                message: `Image ${verb} failed (${model}): ${describeError(cause)}`,
                code: "GENERATION_FAILED",
              }),
            ),
          );

          if (httpResponse.status < 200 || httpResponse.status >= 300) {
            const detail = yield* readApiError(httpResponse);
            if (httpResponse.status === 401 || httpResponse.status === 403) {
              return yield* ImageError.make({
                message: `OpenAI API key was rejected (${detail}). Set ${OPENAI_API_KEY_ENV} or run \`okra keys set openai\`.`,
                code: "AUTH_EXPIRED",
              });
            }
            return yield* ImageError.make({
              message: `Image ${verb} failed (${model}, HTTP ${httpResponse.status}): ${detail}`,
              code: "GENERATION_FAILED",
            });
          }

          const response = yield* decodeImagesResponse(httpResponse).pipe(
            Effect.mapError((cause) =>
              ImageError.make({
                message: `OpenAI returned an unexpected response (${model}): ${describeError(cause)}`,
                code: "GENERATION_FAILED",
              }),
            ),
          );

          const encoded = (response.data ?? [])
            .map((item) => item.b64_json)
            .filter((b64): b64 is string => b64 !== undefined);
          if (encoded.length === 0) {
            return yield* ImageError.make({
              message: "OpenAI returned no image data. Try rephrasing the prompt.",
              code: "NO_IMAGE",
            });
          }
          return yield* Effect.forEach(encoded, decodeBase64);
        });

        const generate = Effect.fn("OpenAiImages.generate")(function* (input: OpenAiImageInput) {
          const key = yield* apiKey;
          const request: typeof CreateImageRequest.Encoded = {
            model: input.model,
            prompt: input.prompt,
            size: input.size,
            output_format: input.format,
            ...omitUndefined({
              quality: input.quality,
              background: input.background,
              n: input.n,
            }),
          };
          const http = yield* HttpClientRequest.post(`${OPENAI_API_URL}/images/generations`).pipe(
            HttpClientRequest.bearerToken(Redacted.value(key)),
            encodeImageRequest(request),
            Effect.mapError((cause) =>
              ImageError.make({
                message: `Invalid image request: ${cause.message}`,
                code: "INVALID_INPUT",
              }),
            ),
          );
          return yield* runImages(http, input.model, "generation");
        });

        const edit = Effect.fn("OpenAiImages.edit")(function* (input: OpenAiEditInput) {
          const key = yield* apiKey;
          const form = new globalThis.FormData();
          form.append("prompt", input.prompt);
          form.append("model", input.model);
          form.append("size", input.size);
          form.append("output_format", input.format);
          if (input.quality !== undefined) form.append("quality", input.quality);
          if (input.background !== undefined) form.append("background", input.background);
          if (input.n !== undefined) form.append("n", String(input.n));
          if (input.inputFidelity !== undefined) form.append("input_fidelity", input.inputFidelity);
          const imageKey = formImageKey(input.images.length);
          input.images.forEach((img, i) => form.append(imageKey, toBlob(img, `image-${i}`)));
          if (input.mask !== undefined) form.append("mask", toBlob(input.mask, "mask"));

          const http = HttpClientRequest.post(`${OPENAI_API_URL}/images/edits`, {
            body: HttpBody.formData(form),
          }).pipe(HttpClientRequest.bearerToken(Redacted.value(key)));
          return yield* runImages(http, input.model, "edit");
        });

        return { generate, edit };
      }),
    );
}

const decodeBase64 = (base64: string): Effect.Effect<Uint8Array, ImageError> =>
  Effect.try({
    try: () => Uint8Array.fromBase64(base64),
    catch: () =>
      ImageError.make({
        message: "OpenAI returned invalid base64 image data",
        code: "DECODE_FAILED",
      }),
  });

const describeError = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = (cause as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(cause);
};

const ApiErrorBody = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});
const decodeApiErrorBody = Schema.decodeUnknownEffect(Schema.fromJsonString(ApiErrorBody));

const readApiError = Effect.fn("OpenAiImages.readApiError")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  const body = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
  const decoded = yield* decodeApiErrorBody(body).pipe(Effect.option);
  if (Option.isSome(decoded)) return decoded.value.error.message;
  if (body.length > 0) return body.slice(0, 300);
  return "no error detail in response";
});
