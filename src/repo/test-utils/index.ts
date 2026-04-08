import type { Ref } from "effect";
import { Layer } from "effect";

import type { CacheService } from "../services/cache.js";
import type { GitService } from "../services/git.js";
import type { MetadataService } from "../services/metadata.js";
import type { RegistryService } from "../services/registry.js";
import {
  createMockCacheService,
  createMockGitService,
  createMockMetadataService,
  createMockRegistryService,
  type MockCacheState,
  type MockGitState,
  type MockMetadataState,
  type MockRegistryState,
} from "./layers/index.js";
import { createSequenceRef, type RecordedCall } from "./sequence.js";

export * from "./layers/index.js";
export * from "./sequence.js";
export * from "./run-cli.js";

export type TestServices = GitService | CacheService | MetadataService | RegistryService;

export interface CreateTestLayerOptions {
  git?: Partial<MockGitState>;
  cache?: Partial<MockCacheState>;
  metadata?: Partial<MockMetadataState>;
  registry?: Partial<MockRegistryState>;
}

export interface TestLayerResult {
  layer: Layer.Layer<TestServices>;
  git: ReturnType<typeof createMockGitService>;
  cache: ReturnType<typeof createMockCacheService>;
  metadata: ReturnType<typeof createMockMetadataService>;
  registry: ReturnType<typeof createMockRegistryService>;
  sequenceRef: Ref.Ref<RecordedCall[]>;
}

export function createTestLayer(options: CreateTestLayerOptions = {}): TestLayerResult {
  const sequenceRef = createSequenceRef();

  const git = createMockGitService({
    ...(options.git && { initialState: options.git }),
    sequenceRef,
  });
  const cache = createMockCacheService({
    ...(options.cache && { initialState: options.cache }),
    sequenceRef,
  });
  const metadata = createMockMetadataService({
    ...(options.metadata && { initialState: options.metadata }),
    sequenceRef,
  });
  const registry = createMockRegistryService({
    ...(options.registry && { initialState: options.registry }),
    sequenceRef,
  });

  const layer = Layer.mergeAll(git.layer, cache.layer, metadata.layer, registry.layer);

  return {
    layer,
    git,
    cache,
    metadata,
    registry,
    sequenceRef,
  };
}
