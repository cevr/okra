import { Effect, Layer, Ref } from "effect";
import { GitService } from "../../services/git.js";
import { recordCall, type SequenceRef } from "../sequence.js";

export interface MockGitState {
  clonedRepos: Map<string, { url: string; ref?: string; depth?: number }>;
  updatedPaths: string[];
  defaultBranch: string;
  currentRef: string;
}

export const defaultMockGitState: MockGitState = {
  clonedRepos: new Map(),
  updatedPaths: [],
  defaultBranch: "main",
  currentRef: "v1.0.0",
};

export interface CreateMockGitServiceOptions {
  initialState?: Partial<MockGitState>;
  sequenceRef?: SequenceRef;
}

export function createMockGitService(options: CreateMockGitServiceOptions = {}): {
  layer: Layer.Layer<GitService>;
  stateRef: Ref.Ref<MockGitState>;
  getState: () => Effect.Effect<MockGitState>;
} {
  const initialState = options.initialState ?? {};
  const sequenceRef = options.sequenceRef;

  const state: MockGitState = {
    ...defaultMockGitState,
    ...initialState,
    clonedRepos: new Map(initialState.clonedRepos ?? []),
    updatedPaths: [...(initialState.updatedPaths ?? [])],
  };
  const stateRef = Ref.makeUnsafe(state);

  const record = (method: string, args: unknown, result?: unknown): Effect.Effect<void> =>
    sequenceRef !== undefined
      ? recordCall(sequenceRef, { service: "git", method, args, result })
      : Effect.void;

  const layer = Layer.succeed(GitService, {
    clone: (url, dest, cloneOpts) =>
      Effect.gen(function* () {
        yield* record("clone", { url, dest, options: cloneOpts });
        const entry: { url: string; ref?: string; depth?: number } = { url };
        if (cloneOpts?.ref !== undefined) entry.ref = cloneOpts.ref;
        if (cloneOpts?.depth !== undefined) entry.depth = cloneOpts.depth;
        yield* Ref.update(stateRef, (s) => ({
          ...s,
          clonedRepos: new Map(s.clonedRepos).set(dest, entry),
        }));
      }),

    update: (path) =>
      Effect.gen(function* () {
        yield* record("update", { path });
        yield* Ref.update(stateRef, (s) => ({
          ...s,
          updatedPaths: [...s.updatedPaths, path],
        }));
      }),

    fetchRefs: (path) => record("fetchRefs", { path }),

    isGitRepo: (path) =>
      Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        const result = s.clonedRepos.has(path);
        yield* record("isGitRepo", { path }, result);
        return result;
      }),

    getDefaultBranch: (url) =>
      Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        yield* record("getDefaultBranch", { url }, s.defaultBranch);
        return s.defaultBranch;
      }),

    getCurrentRef: (path) =>
      Effect.gen(function* () {
        const s = yield* Ref.get(stateRef);
        yield* record("getCurrentRef", { path }, s.currentRef);
        return s.currentRef;
      }),
  });

  return {
    layer,
    stateRef,
    getState: () => Ref.get(stateRef),
  };
}

export const MockGitServiceDefault = createMockGitService();
