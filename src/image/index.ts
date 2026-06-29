import { Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { KeyStoreService } from "../shared/keystore.js";
import { imageCommandDef } from "./commands/index.js";
import { CodexAuthService } from "./services/CodexAuth.js";
import { ImageGenService } from "./services/ImageGen.js";
import { OpenAiImagesService } from "./services/OpenAiImages.js";

// ImageGenService is transport-agnostic; CodexAuthService is consumed by the
// codex model layer the command provides per-invocation. OpenAiImagesService is
// the metered OpenAI Images path; it needs the shared KeyStoreService for key
// resolution. KeyStoreService (and CodexAuthService) require FileSystem | Path,
// which bubble up to the root PlatformLayer (BunServices). HttpClient likewise.
const ImageServiceLayer = Layer.mergeAll(
  ImageGenService.layer,
  CodexAuthService.layer,
  KeyStoreService.layer,
  OpenAiImagesService.layer.pipe(Layer.provide(KeyStoreService.layer)),
);

export const imageCommand = imageCommandDef.pipe(Command.provide(ImageServiceLayer));
