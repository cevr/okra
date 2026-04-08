import { Effect, Layer, Option, Ref } from "effect";
import { CacheService } from "../../services/cache.js";
import type { PackageSpec } from "../../types.js";
import { recordCall, type SequenceRef } from "../sequence.js";

export interface MockCacheState {
  store: Map<string, { content: string; size: number }>;
  cacheDir: string;
}

export const defaultMockCacheState: MockCacheState = {
  store: new Map(),
  cacheDir: "/tmp/test-repo-cache",
};

export interface CreateMockCacheServiceOptions {
  initialState?: Partial<MockCacheState>;
  sequenceRef?: SequenceRef;
}

export function createMockCacheService(options: CreateMockCacheServiceOptions = {}): {
  layer: Layer.Layer<CacheService>;
  stateRef: Ref.Ref<MockCacheState>;
  getState: () => Effect.Effect<MockCacheState>;
  addFile: (path: string, size: number) => Effect.Effect<void>;
} {
  const initialState = options.initialState ?? {};
  const sequenceRef = options.sequenceRef;

  const state: MockCacheState = {
    ...defaultMockCacheState,
    ...initialState,
    store: new Map(initialState.store ?? []),
  };
  const stateRef = Ref.makeUnsafe(state);

  const record = (method: string, args: unknown, result?: unknown): Effect.Effect<void> =>
    sequenceRef !== undefined
      ? recordCall(sequenceRef, { service: "cache", method, args, result })
      : Effect.void;

  const getPath = (spec: PackageSpec) =>
    Effect.gen(function* () {
      const s = yield* Ref.get(stateRef);
      const version = Option.getOrElse(spec.version, () => "default");
      let result: string;
      switch (spec.registry) {
        case "github":
          result = `${s.cacheDir}/${spec.name}`;
          break;
        case "npm":
        case "pypi":
        case "crates":
          result = `${s.cacheDir}/${spec.name}/${version}`;
          break;
      }
      yield* record("getPath", { spec }, result);
      return result;
    });

  const layer = Layer.succeed(CacheService, {
    cacheDir: state.cacheDir,

    getPath,

    remove: (path) =>
      Effect.gen(function* () {
        yield* record("remove", { path });
        yield* Ref.update(stateRef, (s) => {
          const newStore = new Map(s.store);
          for (const key of newStore.keys()) {
            if (key.startsWith(path)) {
              newStore.delete(key);
            }
          }
          return { ...s, store: newStore };
        });
      }),

    removeAll: () =>
      Effect.gen(function* () {
        yield* record("removeAll", {});
        yield* Ref.update(stateRef, (s) => ({ ...s, store: new Map() }));
      }),

    getSize: (path) =>
      Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        let total = 0;
        for (const [key, value] of s.store.entries()) {
          if (key.startsWith(path)) {
            total += value.size;
          }
        }
        yield* record("getSize", { path }, total);
        return total;
      }),

    ensureDir: (path) => record("ensureDir", { path }),
  });

  const addFile = (path: string, size: number) =>
    Ref.update(stateRef, (s) => {
      const newStore = new Map(s.store);
      newStore.set(path, { content: "", size });
      return { ...s, store: newStore };
    });

  return {
    layer,
    stateRef,
    getState: () => Ref.get(stateRef),
    addFile,
  };
}

export const MockCacheServiceDefault = createMockCacheService();
