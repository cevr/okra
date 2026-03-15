// @effect-diagnostics effect/nodeBuiltinImport:off
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Effect, Layer, ServiceMap } from "effect";
import { ResearchError, ErrorCode } from "../errors.js";
import { Session, decodeSession, encodeSession } from "../types.js";
import { xpPaths } from "../paths.js";

export class SessionService extends ServiceMap.Service<
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
  static layer: Layer.Layer<SessionService> = Layer.succeed(SessionService, {
    init: (session) =>
      Effect.gen(function* () {
        const paths = xpPaths(session.projectRoot);
        if (existsSync(paths.sessionJson)) {
          return yield* new ResearchError({
            message: `Session already exists at ${paths.sessionJson}`,
            code: ErrorCode.SESSION_EXISTS,
          });
        }
        mkdirSync(dirname(paths.sessionJson), { recursive: true });
        const json = encodeSession(session);
        writeFileSync(paths.sessionJson, json);
        return session;
      }),

    load: (projectRoot) =>
      Effect.gen(function* () {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.sessionJson)) {
          return yield* new ResearchError({
            message: `No session found at ${paths.sessionJson}`,
            code: ErrorCode.SESSION_NOT_FOUND,
          });
        }
        const raw = readFileSync(paths.sessionJson, "utf-8");
        return decodeSession(raw);
      }),

    update: (projectRoot, patch) =>
      Effect.gen(function* () {
        const paths = xpPaths(projectRoot);
        if (!existsSync(paths.sessionJson)) {
          return yield* new ResearchError({
            message: `No session found at ${paths.sessionJson}`,
            code: ErrorCode.SESSION_NOT_FOUND,
          });
        }
        const raw = readFileSync(paths.sessionJson, "utf-8");
        const existing = decodeSession(raw);
        const updated = new Session({ ...existing, ...patch });
        const json = encodeSession(updated);
        writeFileSync(paths.sessionJson, json);
        return updated;
      }),

    exists: (projectRoot) => Effect.sync(() => existsSync(xpPaths(projectRoot).sessionJson)),
  });
}
