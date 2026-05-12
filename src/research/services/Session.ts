import { Effect, Layer, Context } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { ResearchError, ErrorCode } from "../errors.js";
import { Session, decodeSession, encodeSession } from "../types.js";
import { buildXpPaths } from "../paths.js";

const wrapIO = (e: PlatformError, code: ErrorCode = ErrorCode.WRITE_FAILED) =>
  new ResearchError({ message: e.message, code });

export class SessionService extends Context.Service<
  SessionService,
  {
    readonly init: (session: Session) => Effect.Effect<Session, ResearchError>;
    readonly load: (projectRoot: string) => Effect.Effect<Session, ResearchError>;
    readonly update: (
      projectRoot: string,
      patch: Partial<Pick<Session, "currentIteration" | "bestValue" | "bestCommit" | "segment">>,
    ) => Effect.Effect<Session, ResearchError>;
    readonly exists: (projectRoot: string) => Effect.Effect<boolean>;
  }
>()("@cvr/okra/research/services/Session/SessionService") {
  static layer: Layer.Layer<SessionService, never, FileSystem | Path> = Layer.effect(
    SessionService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      return {
        init: Effect.fn("Session.init")(function* (session: Session) {
          const paths = buildXpPaths(path, session.projectRoot);
          const exists = yield* fs
            .exists(paths.sessionJson)
            .pipe(Effect.catch(() => Effect.succeed(false)));
          if (exists) {
            return yield* new ResearchError({
              message: `Session already exists at ${paths.sessionJson}`,
              code: ErrorCode.SESSION_EXISTS,
            });
          }
          yield* fs
            .makeDirectory(path.dirname(paths.sessionJson), { recursive: true })
            .pipe(Effect.mapError((e) => wrapIO(e)));
          const json = encodeSession(session);
          yield* fs
            .writeFileString(paths.sessionJson, json)
            .pipe(Effect.mapError((e) => wrapIO(e)));
          return session;
        }),

        load: Effect.fn("Session.load")(function* (projectRoot: string) {
          const paths = buildXpPaths(path, projectRoot);
          const exists = yield* fs
            .exists(paths.sessionJson)
            .pipe(Effect.catch(() => Effect.succeed(false)));
          if (!exists) {
            return yield* new ResearchError({
              message: `No session found at ${paths.sessionJson}`,
              code: ErrorCode.SESSION_NOT_FOUND,
            });
          }
          const raw = yield* fs
            .readFileString(paths.sessionJson)
            .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
          return decodeSession(raw);
        }),

        update: Effect.fn("Session.update")(function* (
          projectRoot: string,
          patch: Partial<
            Pick<Session, "currentIteration" | "bestValue" | "bestCommit" | "segment">
          >,
        ) {
          const paths = buildXpPaths(path, projectRoot);
          const exists = yield* fs
            .exists(paths.sessionJson)
            .pipe(Effect.catch(() => Effect.succeed(false)));
          if (!exists) {
            return yield* new ResearchError({
              message: `No session found at ${paths.sessionJson}`,
              code: ErrorCode.SESSION_NOT_FOUND,
            });
          }
          const raw = yield* fs
            .readFileString(paths.sessionJson)
            .pipe(Effect.mapError((e) => wrapIO(e, ErrorCode.READ_FAILED)));
          const existing = decodeSession(raw);
          const updated = new Session({
            name: existing.name,
            unit: existing.unit,
            direction: existing.direction,
            provider: existing.provider,
            objective: existing.objective,
            benchmarkCmd: existing.benchmarkCmd,
            maxIterations: existing.maxIterations,
            maxFailures: existing.maxFailures,
            deadline: existing.deadline,
            projectRoot: existing.projectRoot,
            segment: patch.segment ?? existing.segment,
            currentIteration: patch.currentIteration ?? existing.currentIteration,
            bestValue: patch.bestValue ?? existing.bestValue,
            bestCommit: patch.bestCommit ?? existing.bestCommit,
            createdAt: existing.createdAt,
          });
          const json = encodeSession(updated);
          yield* fs
            .writeFileString(paths.sessionJson, json)
            .pipe(Effect.mapError((e) => wrapIO(e)));
          return updated;
        }),

        exists: Effect.fn("Session.exists")(function* (projectRoot: string) {
          const paths = buildXpPaths(path, projectRoot);
          return yield* fs
            .exists(paths.sessionJson)
            .pipe(Effect.catch(() => Effect.succeed(false)));
        }),
      };
    }),
  );
}
