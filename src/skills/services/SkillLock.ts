import { DateTime, Effect, FileSystem, Layer, Option, Path, Schema, Context } from "effect";
import { SkillsError } from "../errors.js";
import { SkillStore } from "./SkillStore.js";

export class LockEntry extends Schema.Class<LockEntry>("LockEntry")({
  source: Schema.String,
  skillPath: Schema.String,
  ref: Schema.optional(Schema.String),
  installedAt: Schema.String,
  updatedAt: Schema.String,
}) {}

export class LockFile extends Schema.Class<LockFile>("LockFile")({
  version: Schema.Literal(1),
  skills: Schema.Record(Schema.String, LockEntry),
}) {}

const decodeLockFileJson = Schema.decodeUnknownEffect(Schema.fromJsonString(LockFile));
const encodeLockFileJson = Schema.encodeUnknownEffect(Schema.fromJsonString(LockFile));

export class SkillLock extends Context.Service<
  SkillLock,
  {
    readonly read: Effect.Effect<LockFile, SkillsError>;
    readonly get: (name: string) => Effect.Effect<Option.Option<LockEntry>, SkillsError>;
    readonly add: (
      name: string,
      source: string,
      skillPath: string,
      ref?: string,
    ) => Effect.Effect<void, SkillsError>;
    readonly addMany: (
      entries: ReadonlyArray<{ name: string; source: string; skillPath: string; ref?: string }>,
    ) => Effect.Effect<void, SkillsError>;
    readonly remove: (name: string) => Effect.Effect<void, SkillsError>;
    readonly update: (name: string) => Effect.Effect<void, SkillsError>;
    readonly updateMany: (
      entries: ReadonlyArray<{ name: string; skillPath?: string }>,
    ) => Effect.Effect<void, SkillsError>;
  }
>()("@cvr/okra/skills/services/SkillLock") {}

export const SkillLockLive = Layer.effect(
  SkillLock,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const store = yield* SkillStore;

    const lockPath = pathService.join(store.dir, ".skill-lock.json");

    const readLock: Effect.Effect<LockFile, SkillsError> = Effect.gen(function* () {
      const exists = yield* fs.exists(lockPath);
      if (!exists) {
        return new LockFile({ version: 1, skills: {} });
      }
      const raw = yield* fs.readFileString(lockPath);
      return yield* decodeLockFileJson(raw);
    }).pipe(
      Effect.mapError(
        () =>
          new SkillsError({
            message: "Failed to read or write skill lock file",
            code: "LOCK_FILE",
          }),
      ),
      Effect.withSpan("SkillLock.read"),
    );

    const writeLock = (lock: LockFile): Effect.Effect<void, SkillsError> =>
      Effect.gen(function* () {
        const encoded = yield* encodeLockFileJson(lock);
        yield* fs.makeDirectory(pathService.dirname(lockPath), { recursive: true });
        yield* fs.writeFileString(lockPath, encoded + "\n");
      }).pipe(
        Effect.mapError(
          () =>
            new SkillsError({
              message: "Failed to read or write skill lock file",
              code: "LOCK_FILE",
            }),
        ),
        Effect.withSpan("SkillLock.write"),
      );

    // B2: Don't swallow SkillsError — only return none when file doesn't exist
    const get = (name: string) =>
      readLock.pipe(
        Effect.map((lock) => Option.fromNullishOr(lock.skills[name])),
        Effect.withSpan("SkillLock.get", { attributes: { name } }),
      );

    // B4: Preserve installedAt on re-add
    const add = (name: string, source: string, skillPath: string, ref?: string) =>
      Effect.gen(function* () {
        const lock = yield* readLock;
        const now = (yield* DateTime.now).pipe(DateTime.formatIso);
        const existing = lock.skills[name];
        const entry = new LockEntry({
          source,
          skillPath,
          ref,
          installedAt: existing?.installedAt ?? now,
          updatedAt: now,
        });
        const updated = new LockFile({
          version: 1,
          skills: { ...lock.skills, [name]: entry },
        });
        yield* writeLock(updated);
      }).pipe(Effect.withSpan("SkillLock.add", { attributes: { name, source } }));

    // B1/B4: Single read-modify-write, preserve installedAt
    const addMany = Effect.fn("SkillLock.addMany")(function* (
      entries: ReadonlyArray<{ name: string; source: string; skillPath: string; ref?: string }>,
    ) {
      if (entries.length === 0) return;
      const lock = yield* readLock;
      const now = (yield* DateTime.now).pipe(DateTime.formatIso);
      const newSkills = { ...lock.skills };
      for (const { name, source, skillPath, ref } of entries) {
        const existing = newSkills[name];
        newSkills[name] = new LockEntry({
          source,
          skillPath,
          ref,
          installedAt: existing?.installedAt ?? now,
          updatedAt: now,
        });
      }
      yield* writeLock(new LockFile({ version: 1, skills: newSkills }));
    });

    const remove = (name: string) =>
      Effect.gen(function* () {
        const lock = yield* readLock;
        const { [name]: _, ...rest } = lock.skills;
        yield* writeLock(new LockFile({ version: 1, skills: rest }));
      }).pipe(Effect.withSpan("SkillLock.remove", { attributes: { name } }));

    const update = (name: string) =>
      Effect.gen(function* () {
        const lock = yield* readLock;
        const entry = lock.skills[name];
        if (!entry) return;
        const now = (yield* DateTime.now).pipe(DateTime.formatIso);
        const updated = new LockFile({
          version: 1,
          skills: {
            ...lock.skills,
            [name]: new LockEntry({
              source: entry.source,
              skillPath: entry.skillPath,
              ref: entry.ref,
              installedAt: entry.installedAt,
              updatedAt: now,
            }),
          },
        });
        yield* writeLock(updated);
      }).pipe(Effect.withSpan("SkillLock.update", { attributes: { name } }));

    const updateMany = Effect.fn("SkillLock.updateMany")(function* (
      entries: ReadonlyArray<{ name: string; skillPath?: string }>,
    ) {
      if (entries.length === 0) return;
      const lock = yield* readLock;
      const now = (yield* DateTime.now).pipe(DateTime.formatIso);
      const newSkills = { ...lock.skills };
      for (const { name, skillPath } of entries) {
        const entry = newSkills[name];
        if (entry) {
          newSkills[name] = new LockEntry({
            source: entry.source,
            skillPath: skillPath ?? entry.skillPath,
            ref: entry.ref,
            installedAt: entry.installedAt,
            updatedAt: now,
          });
        }
      }
      yield* writeLock(new LockFile({ version: 1, skills: newSkills }));
    });

    return { read: readLock, get, add, addMany, remove, update, updateMany };
  }),
);
