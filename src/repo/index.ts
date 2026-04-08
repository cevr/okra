import { Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { repoRoot } from "./commands/index.js";
import { CacheService } from "./services/cache.js";
import { MetadataService } from "./services/metadata.js";
import { GitService } from "./services/git.js";
import { RegistryService } from "./services/registry.js";

const CoreServicesLayer = Layer.mergeAll(
  CacheService.layer,
  MetadataService.layer,
  GitService.layer,
);

const RepoServiceLayer = RegistryService.layer.pipe(Layer.provideMerge(CoreServicesLayer));

export const repoCommand = repoRoot.pipe(Command.provide(RepoServiceLayer));
