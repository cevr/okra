import { Console, Effect, Layer, Option, Schema, ServiceMap } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { ScheduleError } from "../errors.js";
import { resolvePaths } from "../paths.js";
import { ScheduleSchema, type Schedule } from "./Schedule.js";
import type { Provider } from "../../shared/provider.js";

export type { Provider };

const OptionalString = Schema.optional(Schema.String);
const OptionalNumber = Schema.optional(Schema.Number);

export const TaskContext = Schema.Struct({
  gitBranch: OptionalString,
  gitRemoteUrl: OptionalString,
  gitRepo: OptionalString,
  gitCommit: OptionalString,
  gitDefaultBranch: OptionalString,
  prNumber: OptionalNumber,
  prUrl: OptionalString,
  issueNumber: OptionalNumber,
});

export type TaskContext = typeof TaskContext.Type;

export const StopCondition = Schema.TaggedUnion({
  MaxRuns: { count: Schema.Number },
  AfterDate: { date: Schema.String },
});

export type StopCondition = typeof StopCondition.Type;

export const ConditionalStop = Schema.Struct({
  condition: Schema.String,
});

export type ConditionalStop = typeof ConditionalStop.Type;

export class Task extends Schema.Class<Task>("@cvr/okra/schedule/Task")({
  id: Schema.String,
  prompt: Schema.String,
  provider: Schema.Literals(["claude", "codex"]),
  schedule: ScheduleSchema,
  cwd: Schema.String,
  createdAt: Schema.String,
  status: Schema.Literals(["active", "completed", "failed"]),
  lastRun: Schema.optional(Schema.String),
  runCount: Schema.Number,
  context: Schema.optional(TaskContext),
  stopConditions: Schema.optional(Schema.Array(StopCondition)),
  conditionalStop: Schema.optional(ConditionalStop),
}) {}

export type TaskInput = {
  readonly id: string;
  readonly prompt: string;
  readonly provider: Provider;
  readonly schedule: Schedule;
  readonly cwd: string;
  readonly context?: TaskContext | undefined;
  readonly stopConditions?: ReadonlyArray<StopCondition> | undefined;
  readonly conditionalStop?: ConditionalStop | undefined;
};

const VALID_ID = /^[a-zA-Z0-9_-]+$/;

const validateId = Effect.fn("StoreService.validateId")(function* (id: string) {
  if (!VALID_ID.test(id)) {
    return yield* new ScheduleError({
      message: `Invalid task ID: "${id}". Only alphanumeric, hyphens, and underscores allowed.`,
      code: "INVALID_ID",
    });
  }
  return id;
});

const TaskJson = Schema.fromJsonString(Task);
const decodeTask = Schema.decodeUnknownEffect(TaskJson);
const encodeTask = Schema.encodeEffect(TaskJson);

class StoreService extends ServiceMap.Service<
  StoreService,
  {
    readonly add: (input: TaskInput) => Effect.Effect<Task, ScheduleError>;
    readonly get: (id: string) => Effect.Effect<Task, ScheduleError>;
    readonly list: () => Effect.Effect<ReadonlyArray<Task>, ScheduleError>;
    readonly update: (
      id: string,
      patch: Partial<Pick<Task, "status" | "lastRun" | "runCount">>,
    ) => Effect.Effect<Task, ScheduleError>;
    readonly remove: (id: string) => Effect.Effect<void, ScheduleError>;
  }
>()("@cvr/okra/schedule/services/Store/StoreService") {
  static layer = Layer.effect(
    StoreService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      const { tasksDir } = yield* resolvePaths;

      yield* fs.makeDirectory(tasksDir, { recursive: true }).pipe(
        Effect.mapError(
          (e: PlatformError) =>
            new ScheduleError({
              message: `Cannot create tasks dir: ${e.message}`,
              code: "WRITE_FAILED",
            }),
        ),
      );

      const taskPath = (id: string) => path.join(tasksDir, `${id}.json`);

      const add = Effect.fn("StoreService.add")(function* (input: TaskInput) {
        yield* validateId(input.id);
        const task = new Task({
          ...input,
          createdAt: new Date().toISOString(),
          status: "active",
          runCount: 0,
        });
        const json = yield* encodeTask(task).pipe(
          Effect.mapError(
            (e) =>
              new ScheduleError({ message: `Encode failed: ${e.message}`, code: "ENCODE_FAILED" }),
          ),
        );
        yield* fs
          .writeFileString(taskPath(input.id), json)
          .pipe(
            Effect.mapError(
              (e: PlatformError) =>
                new ScheduleError({ message: `Write failed: ${e.message}`, code: "WRITE_FAILED" }),
            ),
          );
        return task;
      });

      const get = Effect.fn("StoreService.get")(function* (id: string) {
        yield* validateId(id);
        const content = yield* fs.readFileString(taskPath(id)).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ScheduleError({
                message: `Task not found: ${id} (${e.message})`,
                code: "NOT_FOUND",
              }),
          ),
        );
        return yield* decodeTask(content).pipe(
          Effect.mapError(
            (e) =>
              new ScheduleError({ message: `Decode failed: ${e.message}`, code: "DECODE_FAILED" }),
          ),
        );
      });

      const list = Effect.fn("StoreService.list")(function* () {
        const files = yield* fs.readDirectory(tasksDir).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ScheduleError({
                message: `Read dir failed: ${e.message}`,
                code: "READ_FAILED",
              }),
          ),
        );

        const jsonFiles = files.filter((f) => f.endsWith(".json"));
        const results = yield* Effect.forEach(
          jsonFiles,
          (file) =>
            fs.readFileString(path.join(tasksDir, file)).pipe(
              Effect.flatMap(decodeTask),
              Effect.tapError((e) =>
                Console.error(`Warning: skipping corrupt task file ${file}: ${e.message}`),
              ),
              Effect.option,
            ),
          { concurrency: "unbounded" },
        );
        return results.filter(Option.isSome).map((o) => o.value);
      });

      const update = Effect.fn("StoreService.update")(function* (
        id: string,
        patch: Partial<Pick<Task, "status" | "lastRun" | "runCount">>,
      ) {
        yield* validateId(id);
        const existing = yield* get(id);
        const updated = new Task({ ...existing, ...patch });
        const json = yield* encodeTask(updated).pipe(
          Effect.mapError(
            (e) =>
              new ScheduleError({ message: `Encode failed: ${e.message}`, code: "ENCODE_FAILED" }),
          ),
        );
        yield* fs
          .writeFileString(taskPath(id), json)
          .pipe(
            Effect.mapError(
              (e: PlatformError) =>
                new ScheduleError({ message: `Write failed: ${e.message}`, code: "WRITE_FAILED" }),
            ),
          );
        return updated;
      });

      const remove = Effect.fn("StoreService.remove")(function* (id: string) {
        yield* validateId(id);
        yield* fs.remove(taskPath(id)).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new ScheduleError({
                message: `Remove failed: ${e.message}`,
                code: "REMOVE_FAILED",
              }),
          ),
        );
      });

      return { add, get, list, update, remove };
    }),
  );
}

export { StoreService };
