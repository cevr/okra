// @effect-diagnostics effect/strictBooleanExpressions:off effect/nodeBuiltinImport:off
import { Effect, Fiber, Ref, Schedule } from "effect";

export type SkillStatus =
  | "pending"
  | "running"
  | "updated"
  | "installed"
  | "unchanged"
  | "removed"
  | "failed";

interface State {
  readonly entries: ReadonlyArray<{ readonly name: string; readonly status: SkillStatus }>;
  readonly frame: number;
  readonly drawn: number;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const defaultIsTTY = !!process.stderr.isTTY && !process.env["NO_COLOR"];

const defaultWrite = (text: string) =>
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
    case "installed":
      return "✓";
    case "unchanged":
      return "·";
    case "removed":
      return "↻";
    case "failed":
      return "✗";
  }
};

const verb = (status: SkillStatus, runningVerb: string): string => {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return runningVerb;
    case "updated":
      return "updated";
    case "installed":
      return "installed";
    case "unchanged":
      return "unchanged";
    case "removed":
      return "removed";
    case "failed":
      return "failed";
  }
};

const dim = (s: string, color: boolean) => (color ? `\x1b[2m${s}\x1b[0m` : s);
const green = (s: string, color: boolean) => (color ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s: string, color: boolean) => (color ? `\x1b[31m${s}\x1b[0m` : s);
const cyan = (s: string, color: boolean) => (color ? `\x1b[36m${s}\x1b[0m` : s);

const colorize = (status: SkillStatus, text: string, color: boolean): string => {
  switch (status) {
    case "pending":
      return dim(text, color);
    case "running":
      return cyan(text, color);
    case "updated":
    case "installed":
    case "removed":
      return green(text, color);
    case "unchanged":
      return dim(text, color);
    case "failed":
      return red(text, color);
  }
};

const renderLine = (
  name: string,
  status: SkillStatus,
  frame: number,
  runningVerb: string,
  color: boolean,
): string => {
  const sym = symbol(status, frame);
  const v = verb(status, runningVerb);
  return colorize(status, `  ${sym} ${v.padEnd(10)} ${name}`, color);
};

export interface Progress {
  readonly setStatus: (name: string, status: SkillStatus) => Effect.Effect<void>;
  readonly finish: Effect.Effect<void>;
}

export interface MakeOptions {
  readonly runningVerb?: string;
  readonly tty?: boolean;
  readonly write?: (text: string) => Effect.Effect<void>;
}

export const make = (
  names: ReadonlyArray<string>,
  options: MakeOptions = {},
): Effect.Effect<Progress, never, never> =>
  Effect.gen(function* () {
    const runningVerb = options.runningVerb ?? "updating";
    const tty = options.tty ?? defaultIsTTY;
    const write = options.write ?? defaultWrite;
    const color = tty;

    const drawTty = (state: State): Effect.Effect<void> => {
      const moveUp = ansi.up(state.drawn);
      const lines = state.entries
        .map(
          (e) =>
            `${ansi.clearLine}${ansi.cr}${renderLine(e.name, e.status, state.frame, runningVerb, color)}\n`,
        )
        .join("");
      return write(`${moveUp}${lines}`);
    };

    const printPlain = (name: string, status: SkillStatus): Effect.Effect<void> => {
      if (status === "running" || status === "pending") return Effect.void;
      return write(`${renderLine(name, status, 0, runningVerb, color)}\n`);
    };

    const initial: State = {
      entries: names.map((name) => ({ name, status: "pending" as SkillStatus })),
      frame: 0,
      drawn: 0,
    };
    const ref = yield* Ref.make<State>(initial);

    if (tty) {
      yield* write(ansi.hideCursor);
      // Initial paint
      yield* Ref.update(ref, (s) => ({ ...s, drawn: s.entries.length }));
      yield* Ref.get(ref).pipe(Effect.flatMap(drawTty));
    }

    const ticker = tty
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
        if (tty) {
          yield* Ref.get(ref).pipe(Effect.flatMap(drawTty));
        } else {
          yield* printPlain(name, status);
        }
      });

    const finish = Effect.gen(function* () {
      if (ticker !== null) yield* Fiber.interrupt(ticker);
      if (tty) {
        // Final paint with frame=0 so spinner glyph isn't left behind for
        // anything still marked "running" (shouldn't happen, but be safe)
        yield* Ref.update(ref, (s) => ({ ...s, frame: 0 }));
        yield* Ref.get(ref).pipe(Effect.flatMap(drawTty));
        yield* write(ansi.showCursor);
      }
    });

    return { setStatus, finish };
  });
