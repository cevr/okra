import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it } from "effect-bun-test";
import { isOpenAiImageModel } from "../../src/image/constants.js";
import { isImageError } from "../../src/image/errors.js";
import { OpenAiImagesService } from "../../src/image/services/OpenAiImages.js";
import { KeyStoreService } from "../../src/shared/keystore.js";

// 1x1 transparent PNG, base64.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Mock HttpClient that returns a fixed JSON body + status for every request. */
const mockHttp = (status: number, body: unknown) =>
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );

// Pass `{ openai: "sk-test" }` to simulate a stored key, or `{}` for no key.
const makeLayer = (
  status: number,
  body: unknown,
  keys: Record<string, string> = { openai: "sk-test" },
) =>
  OpenAiImagesService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, mockHttp(status, body)),
        KeyStoreService.layerTest(keys),
      ),
    ),
  );

const input = { prompt: "a cat", model: "gpt-image-1.5", size: "auto", format: "png" as const };

describe("isOpenAiImageModel", () => {
  it.effect("routes GPT-image and DALL·E models to the OpenAI API", () =>
    Effect.sync(() => {
      expect(isOpenAiImageModel("gpt-image-1.5")).toBe(true);
      expect(isOpenAiImageModel("gpt-image-1")).toBe(true);
      expect(isOpenAiImageModel("gpt-image-1-mini")).toBe(true);
      expect(isOpenAiImageModel("dall-e-3")).toBe(true);
      expect(isOpenAiImageModel("gpt-5.5")).toBe(false);
      expect(isOpenAiImageModel("gpt-4o")).toBe(false);
    }),
  );
});

describe("OpenAiImagesService.generate", () => {
  it.effect("decodes the base64 image from a 200 response", () =>
    Effect.gen(function* () {
      const svc = yield* OpenAiImagesService;
      const images = yield* svc.generate(input);
      expect(images.length).toBe(1);
      expect((images[0] as Uint8Array).slice(0, 4)).toEqual(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      );
    }).pipe(Effect.provide(makeLayer(200, { created: 1, data: [{ b64_json: PNG_BASE64 }] }))),
  );

  it.effect("returns one byte array per image when the API returns several", () =>
    Effect.gen(function* () {
      const svc = yield* OpenAiImagesService;
      const images = yield* svc.generate({ ...input, n: 3 });
      expect(images.length).toBe(3);
      for (const bytes of images) {
        expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
      }
    }).pipe(
      Effect.provide(
        makeLayer(200, {
          created: 1,
          data: [{ b64_json: PNG_BASE64 }, { b64_json: PNG_BASE64 }, { b64_json: PNG_BASE64 }],
        }),
      ),
    ),
  );

  it.effect("fails AUTH_MISSING when OPENAI_API_KEY is absent", () =>
    Effect.gen(function* () {
      const svc = yield* OpenAiImagesService;
      const err = yield* Effect.flip(svc.generate(input));
      expect(isImageError(err)).toBe(true);
      expect(err.code).toBe("AUTH_MISSING");
    }).pipe(Effect.provide(makeLayer(200, { created: 1, data: [] }, {}))),
  );

  it.effect("maps a 401 to AUTH_EXPIRED", () =>
    Effect.gen(function* () {
      const svc = yield* OpenAiImagesService;
      const err = yield* Effect.flip(svc.generate(input));
      expect(err.code).toBe("AUTH_EXPIRED");
    }).pipe(Effect.provide(makeLayer(401, { error: { message: "Missing key" } }))),
  );

  it.effect("maps a 400 to GENERATION_FAILED", () =>
    Effect.gen(function* () {
      const svc = yield* OpenAiImagesService;
      const err = yield* Effect.flip(svc.generate(input));
      expect(err.code).toBe("GENERATION_FAILED");
    }).pipe(Effect.provide(makeLayer(400, { error: { message: "bad prompt" } }))),
  );

  it.effect("fails NO_IMAGE when the response has no image data", () =>
    Effect.gen(function* () {
      const svc = yield* OpenAiImagesService;
      const err = yield* Effect.flip(svc.generate(input));
      expect(err.code).toBe("NO_IMAGE");
    }).pipe(Effect.provide(makeLayer(200, { created: 1, data: [] }))),
  );

  it.effect("fails DECODE_FAILED on invalid base64", () =>
    Effect.gen(function* () {
      const svc = yield* OpenAiImagesService;
      const err = yield* Effect.flip(svc.generate(input));
      expect(err.code).toBe("DECODE_FAILED");
    }).pipe(Effect.provide(makeLayer(200, { created: 1, data: [{ b64_json: "!!!nope!!!" }] }))),
  );
});
