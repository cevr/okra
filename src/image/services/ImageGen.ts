import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel, Toolkit } from "effect/unstable/ai";
import { OpenAiTool } from "@effect/ai-openai";
import { IMAGE_INSTRUCTION } from "../constants.js";
import { ImageError } from "../errors.js";

export type ImageFormat = "png" | "webp" | "jpeg";

/** Rendering quality accepted by the OpenAI Images API (codex path ignores it). */
export type ImageQuality = "auto" | "low" | "medium" | "high";

export interface GenerateImageInput {
  readonly prompt: string;
  readonly size: string;
  readonly format: ImageFormat;
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

      // The codex backend mandates streaming (stream: true), so collect the
      // stream parts and pull the image from the tool-result part.
      const parts = yield* LanguageModel.streamText({
        prompt: `${IMAGE_INSTRUCTION}\n\n${input.prompt}`,
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
