import {
  Config,
  ConfigProvider,
  Effect,
  Fiber,
  Option,
  Ref,
  Schedule,
  Semaphore,
  Stream,
} from "effect";
import { Stdio } from "effect/Stdio";
import { Terminal } from "effect/Terminal";

export type SkillStatus =
  | "pending"
  | "running"
  | "updated"
  | "installed"
  | "moved"
  | "unchanged"
  | "removed"
  | "failed";

interface State {
  readonly entries: ReadonlyArray<{ readonly name: string; readonly status: SkillStatus }>;
  readonly frame: number;
  readonly finished: boolean;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const readNoColor = Config.option(Config.String("NO_COLOR"))
  .parse(ConfigProvider.fromEnv())
  .pipe(
    Effect.map(Option.isSome),
    Effect.orElseSucceed(() => false),
  );

const ansi = {
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearLine: "\x1b[2K",
  cr: "\r",
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
    case "moved":
      return "→";
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
    case "moved":
      return "moved";
    case "unchanged":
      return "unchanged";
    case "removed":
      return "removed";
    case "failed":
      return "failed";
  }
};

const wrap = (code: string, s: string, color: boolean): string => {
  if (color) return `\x1b[${code}m${s}\x1b[0m`;
  return s;
};

const dim = (s: string, color: boolean) => wrap("2", s, color);
const green = (s: string, color: boolean) => wrap("32", s, color);
const red = (s: string, color: boolean) => wrap("31", s, color);
const cyan = (s: string, color: boolean) => wrap("36", s, color);

const colorize = (status: SkillStatus, text: string, color: boolean): string => {
  switch (status) {
    case "pending":
      return dim(text, color);
    case "running":
      return cyan(text, color);
    case "updated":
    case "installed":
    case "moved":
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
  readonly columns?: number;
  readonly write?: (text: string) => Effect.Effect<void>;
}

export const make = (
  names: ReadonlyArray<string>,
  options: MakeOptions = {},
): Effect.Effect<Progress, never, Stdio | Terminal> =>
  Effect.gen(function* () {
    const runningVerb = options.runningVerb ?? "updating";
    const noColor = yield* readNoColor;
    const isTty: boolean = process.stderr.isTTY ?? false;
    const defaultIsTTY = isTty && !noColor;
    const tty = options.tty ?? defaultIsTTY;
    const stdio = yield* Stdio;
    const terminal = yield* Terminal;
    // Progress output goes to stderr so it never pollutes piped stdout.
    const stderrSink = stdio.stderr({ endOnDone: false });
    const defaultWrite = (text: string): Effect.Effect<void> =>
      Stream.run(Stream.succeed(text), stderrSink).pipe(Effect.ignore);
    const write = options.write ?? defaultWrite;
    const color = tty;

    const ref = yield* Ref.make<State>({
      entries: names.map((name) => ({ name, status: "pending" as SkillStatus })),
      frame: 0,
      finished: false,
    });
    const lock = yield* Semaphore.make(1);

    const isActive = (status: SkillStatus): boolean => status === "pending" || status === "running";

    const liveLine = (state: State, width: number): string => {
      const active = state.entries.filter((entry) => isActive(entry.status));
      if (active.length === 0) return "";
      const completed = state.entries.length - active.length;
      const line = `  ${symbol("running", state.frame)} ${runningVerb} ${completed}/${state.entries.length}`;
      const columns = Math.max(0, (options.columns ?? width) - 1);
      return cyan(line.slice(0, columns), color);
    };

    const clearLiveLine = `${ansi.cr}${ansi.clearLine}`;
    const repaint = (state: State): Effect.Effect<void> =>
      Effect.gen(function* () {
        const columns = yield* terminal.columns;
        yield* write(`${clearLiveLine}${liveLine(state, columns)}`);
      });

    if (tty && names.length > 0) {
      yield* write(ansi.hideCursor);
      yield* repaint(yield* Ref.get(ref));
    }

    let ticker: Fiber.Fiber<void> | null = null;
    if (tty && names.length > 0) {
      ticker = yield* Effect.gen(function* () {
        const state = yield* Ref.get(ref);
        if (state.finished) return;
        const next = { ...state, frame: state.frame + 1 };
        yield* Ref.set(ref, next);
        yield* repaint(next);
      }).pipe(
        lock.withPermit,
        Effect.repeat(Schedule.spaced("80 millis")),
        Effect.asVoid,
        Effect.forkDetach({ startImmediately: true }),
      );
    }

    const setStatus = (name: string, status: SkillStatus): Effect.Effect<void> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(ref);
        if (state.finished) return;
        const entry = state.entries.find((item) => item.name === name);
        if (entry === undefined || entry.status === status || !isActive(entry.status)) return;
        const next = {
          ...state,
          entries: state.entries.map((item) => {
            if (item.name === name) return { ...item, status };
            return item;
          }),
        };
        yield* Ref.set(ref, next);
        let result = "";
        if (!isActive(status)) {
          result = `${renderLine(name, status, 0, runningVerb, color)}\n`;
        }
        if (tty) {
          const columns = yield* terminal.columns;
          yield* write(`${clearLiveLine}${result}${liveLine(next, columns)}`);
        } else if (result.length > 0) {
          yield* write(result);
        }
      }).pipe(lock.withPermit);

    const finish = Effect.gen(function* () {
      if (ticker !== null) yield* Fiber.interrupt(ticker);
      yield* Effect.gen(function* () {
        const state = yield* Ref.get(ref);
        if (state.finished) return;
        yield* Ref.set(ref, { ...state, finished: true });
        if (tty && names.length > 0) {
          const remaining = state.entries
            .filter((entry) => isActive(entry.status))
            .map((entry) => `${renderLine(entry.name, entry.status, 0, runningVerb, color)}\n`)
            .join("");
          yield* write(`${clearLiveLine}${remaining}${ansi.showCursor}`);
        }
      }).pipe(lock.withPermit);
    });

    return { setStatus, finish };
  });
