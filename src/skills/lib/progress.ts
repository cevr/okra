// @effect-diagnostics effect/strictBooleanExpressions:off effect/nodeBuiltinImport:off
import { Effect, Fiber, Ref, Schedule } from "effect";

export type SkillStatus = "pending" | "running" | "updated" | "unchanged" | "removed" | "failed";

interface State {
  readonly entries: ReadonlyArray<{ readonly name: string; readonly status: SkillStatus }>;
  readonly frame: number;
  readonly drawn: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const isTTY = !!process.stderr.isTTY && !process.env["NO_COLOR"];

const writeStderr = (text: string) =>
  Effect.sync(() => {
    process.stderr.write(text);
  });

const ansi = {
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearLine: "\x1b[2K",
  cr: "\r",
  up: (n: number) => (n > 0 ? `\x1b[${n}A` : ""),
};

const symbol = (status: SkillStatus, frame: number): string => {
  switch (status) {
    case "pending":
      return "◌";
    case "running":
      return SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "⠋";
    case "updated":
      return "✓";
    case "unchanged":
      return "·";
    case "removed":
      return "↻";
    case "failed":
      return "✗";
  }
};

const verb = (status: SkillStatus): string => {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "updating";
    case "updated":
      return "updated";
    case "unchanged":
      return "unchanged";
    case "removed":
      return "removed";
    case "failed":
      return "failed";
  }
};

const colorEnabled = isTTY;
const dim = (s: string) => (colorEnabled ? `\x1b[2m${s}\x1b[0m` : s);
const green = (s: string) => (colorEnabled ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string) => (colorEnabled ? `\x1b[31m${s}\x1b[0m` : s);
const cyan = (s: string) => (colorEnabled ? `\x1b[36m${s}\x1b[0m` : s);

const colorize = (status: SkillStatus, text: string): string => {
  switch (status) {
    case "pending":
      return dim(text);
    case "running":
      return cyan(text);
    case "updated":
    case "removed":
      return green(text);
    case "unchanged":
      return dim(text);
    case "failed":
      return red(text);
  }
};

const renderLine = (name: string, status: SkillStatus, frame: number): string => {
  const sym = symbol(status, frame);
  const v = verb(status);
  return colorize(status, `  ${sym} ${v.padEnd(9)} ${name}`);
};

export interface Progress {
  readonly setStatus: (name: string, status: SkillStatus) => Effect.Effect<void>;
  readonly finish: Effect.Effect<void>;
}

const drawTty = (state: State): Effect.Effect<void> => {
  const moveUp = ansi.up(state.drawn);
  const lines = state.entries
    .map((e) => `${ansi.clearLine}${ansi.cr}${renderLine(e.name, e.status, state.frame)}\n`)
    .join("");
  return writeStderr(`${moveUp}${lines}`);
};

const printPlain = (name: string, status: SkillStatus): Effect.Effect<void> => {
  if (status === "running" || status === "pending") return Effect.void;
  return writeStderr(`${renderLine(name, status, 0)}\n`);
};

export const make = (names: ReadonlyArray<string>): Effect.Effect<Progress, never, never> =>
  Effect.gen(function* () {
    const initial: State = {
      entries: names.map((name) => ({ name, status: "pending" as SkillStatus })),
      frame: 0,
      drawn: 0,
    };
    const ref = yield* Ref.make<State>(initial);

    if (isTTY) {
      yield* writeStderr(ansi.hideCursor);
      // Initial paint
      yield* Ref.update(ref, (s) => ({ ...s, drawn: s.entries.length }));
      yield* Ref.get(ref).pipe(Effect.flatMap(drawTty));
    }

    const ticker = isTTY
      ? yield* Effect.gen(function* () {
          yield* Ref.update(ref, (s) => ({ ...s, frame: s.frame + 1 }));
          yield* Ref.get(ref).pipe(Effect.flatMap(drawTty));
        }).pipe(
          Effect.repeat(Schedule.spaced("80 millis")),
          Effect.ignore,
          Effect.forkDetach({ startImmediately: true }),
        )
      : null;

    const setStatus = (name: string, status: SkillStatus): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Ref.update(ref, (s) => ({
          ...s,
          entries: s.entries.map((e) => (e.name === name ? { ...e, status } : e)),
        }));
        if (isTTY) {
          yield* Ref.get(ref).pipe(Effect.flatMap(drawTty));
        } else {
          yield* printPlain(name, status);
        }
      });

    const finish = Effect.gen(function* () {
      if (ticker !== null) yield* Fiber.interrupt(ticker);
      if (isTTY) {
        // Final paint with frame=0 so spinner glyph isn't left behind for
        // anything still marked "running" (shouldn't happen, but be safe)
        yield* Ref.update(ref, (s) => ({ ...s, frame: 0 }));
        yield* Ref.get(ref).pipe(Effect.flatMap(drawTty));
        yield* writeStderr(ansi.showCursor);
      }
    });

    return { setStatus, finish };
  });
