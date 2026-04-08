import { Effect, Layer, Option, Ref } from "effect";
import { MetadataService } from "../../services/metadata.js";
import type { MetadataIndex } from "../../types.js";
import { specMatches } from "../../types.js";
import { recordCall, type SequenceRef } from "../sequence.js";

export interface MockMetadataState {
  index: MetadataIndex;
}

export const defaultMockMetadataState: MockMetadataState = {
  index: { version: 1, repos: [] },
};

export interface CreateMockMetadataServiceOptions {
  initialState?: Partial<MockMetadataState>;
  sequenceRef?: SequenceRef;
}

export function createMockMetadataService(options: CreateMockMetadataServiceOptions = {}): {
  layer: Layer.Layer<MetadataService>;
  stateRef: Ref.Ref<MockMetadataState>;
  getState: () => Effect.Effect<MockMetadataState>;
} {
  const initialState = options.initialState ?? {};
  const sequenceRef = options.sequenceRef;

  const state: MockMetadataState = {
    ...defaultMockMetadataState,
    ...initialState,
    index: {
      version: initialState.index?.version ?? 1,
      repos: [...(initialState.index?.repos ?? [])],
    },
  };
  const stateRef = Ref.makeUnsafe(state);

  const record = (method: string, args: unknown, result?: unknown): Effect.Effect<void> =>
    sequenceRef !== undefined
      ? recordCall(sequenceRef, { service: "metadata", method, args, result })
      : Effect.void;

  const layer = Layer.succeed(MetadataService, {
    load: () =>
      Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        yield* record("load", {}, s.index);
        return s.index;
      }),

    save: (newIndex) =>
      Effect.gen(function* () {
        yield* record("save", { index: newIndex });
        yield* Ref.update(stateRef, (s) => ({ ...s, index: newIndex }));
      }),

    add: (metadata) =>
      Effect.gen(function* () {
        yield* record("add", { metadata });
        yield* Ref.update(stateRef, (s) => {
          const filtered = s.index.repos.filter((r) => !specMatches(r.spec, metadata.spec));
          return {
            ...s,
            index: { ...s.index, repos: [...filtered, metadata] },
          };
        });
      }),

    remove: (spec) =>
      Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        const originalLength = s.index.repos.length;
        const filtered = s.index.repos.filter((r) => !specMatches(r.spec, spec));
        const result = filtered.length < originalLength;
        yield* record("remove", { spec }, result);
        yield* Ref.set(stateRef, {
          ...s,
          index: { ...s.index, repos: filtered },
        });
        return result;
      }),

    find: (spec) =>
      Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        const result = Option.fromNullishOr(s.index.repos.find((r) => specMatches(r.spec, spec)));
        yield* record("find", { spec }, result);
        return result;
      }),

    updateAccessTime: (spec) =>
      Effect.gen(function* () {
        yield* record("updateAccessTime", { spec });
        yield* Ref.update(stateRef, (s) => ({
          ...s,
          index: {
            ...s.index,
            repos: s.index.repos.map((r) => {
              if (specMatches(r.spec, spec)) {
                return { ...r, lastAccessedAt: new Date().toISOString() };
              }
              return r;
            }),
          },
        }));
      }),

    all: () =>
      Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        yield* record("all", {}, s.index.repos);
        return s.index.repos;
      }),
  });

  return {
    layer,
    stateRef,
    getState: () => Ref.get(stateRef),
  };
}

export const MockMetadataServiceDefault = createMockMetadataService();
