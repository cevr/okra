import { Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { command } from "./commands/index.js";
import { ConfigService } from "./services/Config.js";
import { VaultService } from "./services/Vault.js";
import { BuildInfo } from "./services/BuildInfo.js";
import { AgentPlatformService } from "./services/AgentPlatform.js";

const CoreLayer = Layer.mergeAll(ConfigService.layer, VaultService.layer, BuildInfo.layer);

const BrainServiceLayer = Layer.mergeAll(
  CoreLayer,
  AgentPlatformService.layer.pipe(Layer.provide(ConfigService.layer)),
);

export const brainCommand = command.pipe(Command.provide(BrainServiceLayer));

const BRAIN_ERROR_TAGS = new Set([
  "@cvr/okra/brain/BrainError",
  "@cvr/okra/brain/VaultError",
  "@cvr/okra/brain/ConfigError",
]);

export const isBrainDomainError = (
  e: unknown,
): e is { _tag: string; code: string; message: string } => {
  if (typeof e !== "object" || e === null || !("_tag" in e)) return false;
  const tag = (e as { _tag: unknown })._tag;
  return typeof tag === "string" && BRAIN_ERROR_TAGS.has(tag);
};
