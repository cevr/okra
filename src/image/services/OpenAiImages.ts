import { Context, Effect, Layer, Redacted } from "effect";
import { HttpBody, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { Generated } from "@effect/ai-openai";
import { KeyStoreService } from "../../shared/keystore.js";
import { OPENAI_API_KEY_ENV, OPENAI_API_URL, OPENAI_KEY_NAME } from "../constants.js";
import { ImageError } from "../errors.js";
import type { ImageFormat, ImageQuality } from "./ImageGen.js";

export interface OpenAiImageInput {
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
  readonly format: ImageFormat;
  /** Rendering quality; the API maps `auto`/`low`/`medium`/`high` per model. Omitted → model default. */
  readonly quality?: ImageQuality;
  /** Transparent vs opaque background (GPT image models only). Omitted → model default. */
  readonly background?: "transparent" | "opaque" | "auto";
  /** Number of images to request. Omitted → 1. */
  readonly n?: number;
}

/** A binary image payload destined for a multipart edit request. */
export interface ImagePart {
  readonly data: Uint8Array;
  /** MIME type, e.g. "image/png" — becomes the form-part content type. */
  readonly mediaType: string;
}

export interface OpenAiEditInput {
  readonly prompt: string;
  readonly model: string;
  readonly size: string;
  readonly format: ImageFormat;
  /** Source image(s) to edit; multipart `image` (GPT image models accept up to 16). */
  readonly images: ReadonlyArray<ImagePart>;
  /** Optional PNG mask whose transparent areas mark where to edit. */
  readonly mask?: ImagePart;
  readonly quality?: ImageQuality;
  readonly background?: "transparent" | "opaque" | "auto";
  readonly n?: number;
}

const decodeImagesResponse = HttpClientResponse.schemaBodyJson(Generated.ImagesResponse);

/** Extension to put on a form-part filename so the API infers the right type. */
const extForMedia = (mediaType: string): string => {
  if (mediaType === "image/jpeg") return "jpg";
  if (mediaType === "image/webp") return "webp";
  return "png";
};

const toBlob = (part: ImagePart, name: string): globalThis.File => {
  // Copy into a fresh ArrayBuffer-backed view so the BlobPart type is exact
  // (a SharedArrayBuffer-backed Uint8Array is not a valid BlobPart).
  const buffer = new Uint8Array(part.data.length);
  buffer.set(part.data);
  return new globalThis.File([buffer], `${name}.${extForMedia(part.mediaType)}`, {
    type: part.mediaType,
  });
};

/**
 * Generates images through the metered OpenAI Images API (`/images/generations`)
 * using an `OPENAI_API_KEY`. This is the non-codex path: selected when `--model`
 * names a GPT image / DALL·E model. Always returns base64 for the GPT image
 * models, which we decode to raw bytes.
 */
export class OpenAiImagesService extends Context.Service<
  OpenAiImagesService,
  {
    /** Generate from a prompt (`/images/generations`). One byte array per image (`--n`). */
    readonly generate: (
      input: OpenAiImageInput,
    ) => Effect.Effect<ReadonlyArray<Uint8Array>, ImageError>;
    /** Edit source image(s) under a prompt (`/images/edits`, multipart). One byte array per image. */
    readonly edit: (input: OpenAiEditInput) => Effect.Effect<ReadonlyArray<Uint8Array>, ImageError>;
  }
>()("@cvr/okra/image/services/OpenAiImages/OpenAiImagesService") {
  static layer: Layer.Layer<OpenAiImagesService, never, HttpClient.HttpClient | KeyStoreService> =
    Layer.effect(
      OpenAiImagesService,
      Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient;
        const keyStore = yield* KeyStoreService;

        // env OPENAI_API_KEY > stored ~/.okra/keys.json; map the store's error
        // into this domain's AUTH_MISSING so callers see a single error type.
        const apiKey = keyStore.resolve(OPENAI_KEY_NAME, OPENAI_API_KEY_ENV).pipe(
          Effect.mapError(
            () =>
              new ImageError({
                message: `No OpenAI API key. Set ${OPENAI_API_KEY_ENV} or run \`okra keys set openai\`.`,
                code: "AUTH_MISSING",
              }),
          ),
        );

        /** Run a prepared request, normalise auth/transport failures, return decoded images. */
        const runImages = Effect.fn("OpenAiImages.run")(function* (
          request: HttpClientRequest.HttpClientRequest,
          model: string,
          verb: string,
        ) {
          const response = yield* httpClient.execute(request).pipe(
            // Turn non-2xx into a StatusCodeError BEFORE attempting to decode a
            // success body, so an error JSON isn't misread as a schema mismatch.
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(decodeImagesResponse),
            Effect.mapError((cause) =>
              statusOf(cause) === 401 || statusOf(cause) === 403
                ? new ImageError({
                    message: `OpenAI API key was rejected (invalid or lacks access to ${model}). Set ${OPENAI_API_KEY_ENV} or run \`okra keys set openai\`.`,
                    code: "AUTH_EXPIRED",
                  })
                : new ImageError({
                    message: `Image ${verb} failed (${model}): ${describeError(cause)}`,
                    code: "GENERATION_FAILED",
                  }),
            ),
          );

          // Collect every returned image (the API returns `--n` of them).
          const encoded = (response.data ?? [])
            .map((item) => item.b64_json)
            .filter((b64): b64 is string => b64 !== undefined);
          if (encoded.length === 0) {
            return yield* new ImageError({
              message: "OpenAI returned no image data. Try rephrasing the prompt.",
              code: "NO_IMAGE",
            });
          }
          return yield* Effect.forEach(encoded, decodeBase64);
        });

        const generate = Effect.fn("OpenAiImages.generate")(function* (input: OpenAiImageInput) {
          const key = yield* apiKey;
          const request: typeof Generated.CreateImageRequest.Encoded = {
            model: input.model,
            prompt: input.prompt,
            size: input.size,
            output_format: input.format,
            // Optional knobs — only sent when set, so model defaults stand otherwise.
            ...(input.quality === undefined ? {} : { quality: input.quality }),
            ...(input.background === undefined ? {} : { background: input.background }),
            ...(input.n === undefined ? {} : { n: input.n }),
          };
          const http = HttpClientRequest.post(`${OPENAI_API_URL}/images/generations`, {
            body: HttpBody.jsonUnsafe(request),
          }).pipe(HttpClientRequest.bearerToken(Redacted.value(key)));
          return yield* runImages(http, input.model, "generation");
        });

        const edit = Effect.fn("OpenAiImages.edit")(function* (input: OpenAiEditInput) {
          const key = yield* apiKey;
          // `/images/edits` is multipart: the source image(s) and optional mask are
          // binary form parts (the high-level client never surfaces createImageEdit,
          // so we build the request directly, mirroring the generations path).
          const form = new globalThis.FormData();
          form.append("prompt", input.prompt);
          form.append("model", input.model);
          form.append("size", input.size);
          form.append("output_format", input.format);
          if (input.quality !== undefined) form.append("quality", input.quality);
          if (input.background !== undefined) form.append("background", input.background);
          if (input.n !== undefined) form.append("n", String(input.n));
          // Multiple sources repeat the `image[]` key; a single source uses `image`.
          const imageKey = input.images.length > 1 ? "image[]" : "image";
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
      new ImageError({
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

/**
 * HTTP status of a failed request, if available. A non-2xx response surfaces as
 * an `HttpClientError` whose `reason` is a `StatusCodeError` carrying the
 * response (and thus its `.status`).
 */
const statusOf = (cause: unknown): number | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined;
  const reason = (cause as { reason?: { response?: { status?: number } } }).reason;
  return reason?.response?.status;
};
