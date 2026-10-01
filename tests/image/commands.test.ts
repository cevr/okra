import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Option, Redacted, Schema } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Command } from "effect/cli";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "effect-bun-test";
import { imageCommandDef } from "../../src/image/commands/index.js";
import { CodexAuthService } from "../../src/image/services/CodexAuth.js";
import { ImageGenService } from "../../src/image/services/ImageGen.js";
import { OpenAiImagesService } from "../../src/image/services/OpenAiImages.js";
import { CodexModelsService } from "../../src/shared/codex-models.js";
import { KeyStoreService } from "../../src/shared/keystore.js";
import { ModelCatalogService } from "../../src/shared/model-catalog.js";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
interface RequestCapture {
  url?: string;
  json?: unknown;
  form?: FormData;
}
const decodeModel = Schema.decodeUnknownOption(Schema.Struct({ model: Schema.String }));

const testLayer = (
  capture: RequestCapture,
  codex = false,
  listedModels: ReadonlyArray<string> = ["gpt-6-sol"],
  rejectedModels: ReadonlyArray<string> = [],
) => {
  const http = HttpClient.make((request) => {
    capture.url = request.url;
    if (request.body._tag === "Uint8Array") {
      capture.json = decodeJson(new TextDecoder().decode(request.body.body));
      const model = Option.map(decodeModel(capture.json), (body) => body.model);
      if (Option.isSome(model) && rejectedModels.includes(model.value)) {
        const detail = `The '${model.value}' model is not supported when using Codex with a ChatGPT account.`;
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(encodeJson({ detail }), { status: 400 }),
          ),
        );
      }
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
    CodexModelsService.layerTest(Option.some(listedModels)),
    ModelCatalogService.layerTest({
      openai: {
        models: {
          "gpt-6-sol": { family: "gpt-sol", release_date: "2026-09-22" },
          "gpt-6.1-sol": { family: "gpt-sol", release_date: "2026-09-29" },
        },
      },
    }),
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

  it.scoped("uses the subscription image tool without an image model", () => {
    const capture: RequestCapture = {};
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* cli(["a red dot", "-o", `${dir}/out.png`]);
      expect(capture.url).toBe("https://chatgpt.com/backend-api/codex/responses");
      expect(capture.json).toMatchObject({
        model: "gpt-6-sol",
        store: false,
        stream: true,
        tools: [{ type: "image_generation" }],
      });
      // The codex backend always uses its own image model, so okra sends none.
      expect(encodeJson(capture.json)).not.toContain("gpt-image");
      expect(yield* fs.readFile(`${dir}/out.png`)).toEqual(Uint8Array.fromBase64(PNG));
    }).pipe(Effect.provide(testLayer(capture, true)));
  });

  it.effect("no longer accepts --image-model", () => {
    const capture: RequestCapture = {};
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(
        cli(["a red dot", "--image-model", "gpt-image-2.5-sunburst"]),
      );
      expect(exit._tag).toBe("Failure");
      expect(capture.url).toBeUndefined();
    }).pipe(Effect.provide(testLayer(capture, true)));
  });

  it.scoped("asks codex for the size in the prompt and notes a different result", () => {
    const capture: RequestCapture = {};
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      const errors: Array<string> = [];
      const console: Console.Console = {
        ...globalThis.console,
        log: () => {},
        error: (...args: ReadonlyArray<unknown>) => {
          errors.push(args.map(String).join(" "));
        },
      };
      yield* cli(["a red dot", "--size", "1024x1536", "-o", `${dir}/out.png`]).pipe(
        Effect.provideService(Console.Console, console),
      );
      expect(encodeJson(capture.json)).toContain(
        "Output size: exactly 1024x1536 pixels (portrait).",
      );
      // The fake backend returns a 1x1 PNG.
      expect(errors.join("\n")).toContain("codex returned 1x1 for --size 1024x1536");
    }).pipe(Effect.provide(testLayer(capture, true)));
  });

  it.scoped("falls back to an older Sol model when codex rejects the newest", () => {
    const capture: RequestCapture = {};
    return Effect.gen(function* () {
      const fs = yield* FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped();
      yield* cli(["a red dot", "-o", `${dir}/out.png`]);
      expect(capture.json).toMatchObject({ model: "gpt-6-sol" });
      expect(yield* fs.readFile(`${dir}/out.png`)).toEqual(Uint8Array.fromBase64(PNG));
    }).pipe(
      Effect.provide(testLayer(capture, true, ["gpt-6-sol", "gpt-6.1-sol"], ["gpt-6.1-sol"])),
    );
  });

  for (const flags of [
    ["--model", "gpt-image-1.5", "--quality", "max"],
    ["--model", "gpt-image-2.5-flare", "--fidelity", "high", "--ref", "absent.png"],
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
