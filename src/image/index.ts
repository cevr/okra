import { Layer } from "effect";
import { Command } from "effect/cli";
import { CodexModelsService } from "../shared/codex-models.js";
import { KeyStoreService } from "../shared/keystore.js";
import { ModelCatalogService } from "../shared/model-catalog.js";
import { imageCommandDef } from "./commands/index.js";
import { CodexAuthService } from "./services/CodexAuth.js";
import { ImageGenService } from "./services/ImageGen.js";
import { OpenAiImagesService } from "./services/OpenAiImages.js";

const ImageServiceLayer = Layer.mergeAll(
  ImageGenService.layer,
  CodexAuthService.layer,
  CodexModelsService.layer,
  ModelCatalogService.layer,
  KeyStoreService.layer,
  OpenAiImagesService.layer.pipe(Layer.provide(KeyStoreService.layer)),
);

export const imageCommand = imageCommandDef.pipe(Command.provide(ImageServiceLayer));
