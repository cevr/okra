import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel, Toolkit } from "effect/unstable/ai";
import { OpenAiTool } from "@effect/ai-openai";
import { IMAGE_INSTRUCTION } from "../constants.js";
import { ImageError } from "../errors.js";

export type ImageFormat = "png" | "webp" | "jpeg";

/** Rendering quality accepted by the OpenAI Images API (codex path ignores it). */
export type ImageQuality = "auto" | "low" | "medium" | "high";

/** A reference image to condition generation on (style/composition), not edit. */
export interface ReferenceImage {
  readonly data: Uint8Array;
  /** MIME type, e.g. "image/png" — the codex backend supports PNG/JPEG/WebP. */
  readonly mediaType: string;
}

export interface GenerateImageInput {
  readonly prompt: string;
  readonly size: string;
  readonly format: ImageFormat;
  /** Optional style/composition references attached as input images (codex only). */
  readonly refs?: ReadonlyArray<ReferenceImage>;
}

/** The custom name the OpenAI adapter assigns the image_generation provider tool. */
const IMAGE_TOOL_NAME = "OpenAiImageGeneration";

/**
 * Generates images through a provided `LanguageModel` using the OpenAI
 * `image_generation` provider tool. The model is wired to the ChatGPT "codex"
 * Responses backend at the domain entry point (see `image/index.ts`), so this
 * service is transport-agnostic and easy to test with a mock LanguageModel.
 */
export class ImageGenService extends Context.Service<
  ImageGenService,
  {
    /** Generate an image and return the raw decoded PNG/JPEG/WebP bytes. */
    readonly generate: (
      input: GenerateImageInput,
    ) => Effect.Effect<Uint8Array, ImageError, LanguageModel.LanguageModel>;
  }
>()("@cvr/okra/image/services/ImageGen/ImageGenService") {
  static layer: Layer.Layer<ImageGenService> = Layer.succeed(ImageGenService, {
    generate: Effect.fn("ImageGen.generate")(function* (input: GenerateImageInput) {
      // image_generation is a provider-defined tool: no handler, args set at construction.
      const toolkit = Toolkit.make(
        OpenAiTool.ImageGeneration({ size: input.size, output_format: input.format }),
      );

      const text = `${IMAGE_INSTRUCTION}\n\n${input.prompt}`;
      // With reference images, send a structured user message carrying the text
      // plus each ref as an input image (a `file` part with an image media type,
      // which the OpenAI Responses adapter forwards as `input_image`). Without
      // refs, keep the plain-string prompt so the common path is unchanged.
      const refs = input.refs ?? [];
      const prompt =
        refs.length === 0
          ? text
          : ([
              {
                role: "user",
                content: [
                  { type: "text", text },
                  ...refs.map((ref) => ({
                    type: "file" as const,
                    mediaType: ref.mediaType,
                    data: ref.data,
                  })),
                ],
              },
            ] as const);

      // The codex backend mandates streaming (stream: true), so collect the
      // stream parts and pull the image from the tool-result part.
      const parts = yield* LanguageModel.streamText({
        prompt,
        toolkit,
        // Force the image tool to fire; otherwise the model may reply with text only.
        toolChoice: { tool: IMAGE_TOOL_NAME },
      }).pipe(
        Stream.runCollect,
        Effect.mapError((cause) =>
          isUnauthorized(cause)
            ? new ImageError({
                message: "Codex token rejected (expired or invalid). Run `codex login`.",
                code: "AUTH_EXPIRED",
              })
            : new ImageError({
                message: `Image generation failed: ${describeError(cause)}`,
                code: "GENERATION_FAILED",
              }),
        ),
      );

      const imagePart = parts.find(
        (part) => part.type === "tool-result" && part.name === IMAGE_TOOL_NAME && !part.isFailure,
      );

      if (imagePart === undefined || imagePart.type !== "tool-result" || imagePart.isFailure) {
        return yield* new ImageError({
          message: "Backend returned no image. Try rephrasing the prompt.",
          code: "NO_IMAGE",
        });
      }

      const base64 = imagePart.result.result;
      if (base64 === null) {
        return yield* new ImageError({
          message: "Backend returned an empty image result.",
          code: "NO_IMAGE",
        });
      }

      return yield* decodeBase64(base64);
    }),
  });
}

const decodeBase64 = (base64: string): Effect.Effect<Uint8Array, ImageError> =>
  Effect.try({
    try: () => Uint8Array.fromBase64(base64),
    catch: () =>
      new ImageError({
        message: "Backend returned invalid base64 image data",
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
 * A genuine auth failure surfaces as an `AiError` whose `reason._tag` is
 * `AuthenticationError`. We match on the structured tag rather than the message
 * text — a substring scan for "401"/"unauthorized" false-matched unrelated
 * errors (e.g. an `InvalidOutputError` whose body happened to contain them).
 */
const isUnauthorized = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null || !("reason" in cause)) return false;
  const reason = (cause as { reason: unknown }).reason;
  if (typeof reason !== "object" || reason === null || !("_tag" in reason)) return false;
  return (reason as { _tag: unknown })._tag === "AuthenticationError";
};
