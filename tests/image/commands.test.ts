import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Redacted, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Command } from "effect/unstable/cli";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it } from "effect-bun-test";
import { imageCommandDef } from "../../src/image/commands/index.js";
import { CodexAuthService } from "../../src/image/services/CodexAuth.js";
import { ImageGenService } from "../../src/image/services/ImageGen.js";
import { OpenAiImagesService } from "../../src/image/services/OpenAiImages.js";
import { KeyStoreService } from "../../src/shared/keystore.js";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
interface RequestCapture {
  url?: string;
  json?: unknown;
  form?: FormData;
}
const testLayer = (capture: RequestCapture, codex = false) => {
  const http = HttpClient.make((request) => {
    capture.url = request.url;
    if (request.body._tag === "Uint8Array") {
      capture.json = decodeJson(new TextDecoder().decode(request.body.body));
    }
    if (request.body._tag === "FormData") capture.form = request.body.formData;
    let body = encodeJson({
      created: 1,
      data: [{ b64_json: PNG }],
      quality: "max",
      size: "1536x864",
    });
    if (codex) {
      body = `data: ${encodeJson({ type: "response.output_item.done", output_index: 0, item: { type: "image_generation_call", id: "ig_test", status: "completed", result: PNG } })}\n\n`;
    }
    return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body)));
  });
  const base = Layer.mergeAll(
    BunServices.layer,
    Layer.succeed(HttpClient.HttpClient, http),
    KeyStoreService.layerTest({ openai: "sk-test" }),
    Layer.succeed(CodexAuthService, {
      load: Effect.succeed({
        accessToken: Redacted.make("test-token"),
        accountId: "test-account",
        version: "0.142.3",
      }),
    }),
  );
  return Layer.mergeAll(ImageGenService.layer, OpenAiImagesService.layer).pipe(
    Layer.provideMerge(base),
  );
};
const cli = Command.runWith(imageCommandDef, { version: "test" });

describe("image command", () => {
  for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    it.scoped(`generates and saves ${model} with max quality`, () => {
      const capture: RequestCapture = {};
      return Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const out = `${dir}/out.png`;
        yield* cli([
          "a red dot",
          "--model",
          model,
          "--quality",
          "max",
          "--size",
          "1536x864",
          "-o",
          out,
        ]);
        expect(capture.url).toBe("https://api.openai.com/v1/images/generations");
        expect(capture.json).toMatchObject({ model, quality: "max", size: "1536x864" });
        expect(yield* fs.readFile(out)).toEqual(Uint8Array.fromBase64(PNG));
      }).pipe(Effect.provide(testLayer(capture)));
    });

    it.scoped(`edits and saves ${model} with xhigh quality`, () => {
      const capture: RequestCapture = {};
      return Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const source = `${dir}/source.png`;
        const out = `${dir}/out.png`;
        yield* fs.writeFile(source, Uint8Array.fromBase64(PNG));
        yield* cli([
          "make it blue",
          "--model",
          model,
          "--quality",
          "xhigh",
          "--ref",
          source,
          "--mask",
          source,
          "-o",
          out,
        ]);
        expect(capture.url).toBe("https://api.openai.com/v1/images/edits");
        expect(capture.form?.get("model")).toBe(model);
        expect(capture.form?.get("quality")).toBe("xhigh");
        expect(capture.form?.get("image")).toBeInstanceOf(File);
        expect(capture.form?.get("mask")).toBeInstanceOf(File);
        expect(capture.form?.has("input_fidelity")).toBe(false);
        expect(yield* fs.readFile(out)).toEqual(Uint8Array.fromBase64(PNG));
      }).pipe(Effect.provide(testLayer(capture)));
    });
  }

  for (const selected of [undefined, "gpt-image-2.5-sunburst"]) {
    it.scoped(`uses the subscription image tool with ${selected ?? "default Flare"}`, () => {
      const capture: RequestCapture = {};
      return Effect.gen(function* () {
        const fs = yield* FileSystem;
        const dir = yield* fs.makeTempDirectoryScoped();
        const args = ["a red dot", "-o", `${dir}/out.png`];
        if (selected !== undefined) args.push("--image-model", selected);
        yield* cli(args);
        expect(capture.url).toBe("https://chatgpt.com/backend-api/codex/responses");
        expect(capture.json).toMatchObject({
          model: "gpt-5.5",
          store: false,
          stream: true,
          tools: [{ type: "image_generation", model: selected ?? "gpt-image-2.5-flare" }],
        });
        expect(yield* fs.readFile(`${dir}/out.png`)).toEqual(Uint8Array.fromBase64(PNG));
      }).pipe(Effect.provide(testLayer(capture, true)));
    });
  }

  for (const flags of [
    ["--model", "gpt-image-1.5", "--quality", "max"],
    ["--model", "gpt-image-2.5-flare", "--fidelity", "high", "--ref", "absent.png"],
    ["--model", "gpt-image-2.5-flare", "--image-model", "gpt-image-2.5-sunburst"],
  ]) {
    it.effect(`rejects unsupported controls before network access: ${flags.join(" ")}`, () => {
      const capture: RequestCapture = {};
      return Effect.gen(function* () {
        const error = yield* Effect.flip(cli(["a red dot", ...flags]));
        expect(error).toMatchObject({ code: "INVALID_INPUT" });
        expect(capture.url).toBeUndefined();
      }).pipe(Effect.provide(testLayer(capture)));
    });
  }
});
