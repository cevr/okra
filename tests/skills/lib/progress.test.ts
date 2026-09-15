import { describe, expect, it } from "effect-bun-test";
import { Effect, Layer, Ref } from "effect";
import { TestClock } from "effect/testing";
import * as Stdio from "effect/Stdio";
import * as Terminal from "effect/Terminal";
import { make } from "../../../src/skills/lib/progress.js";

const captureWrites = (output: Ref.Ref<string>) => (text: string) =>
  Ref.update(output, (current) => current + text);

// These tests inject `write`, so the Stdio default is never exercised — a drain layer suffices.
const TestStdio = Layer.mergeAll(
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.never,
      readLine: Effect.never,
      display: () => Effect.void,
    }),
  ),
);

describe("progress", () => {
  it.effect("TTY: spinner ticks do not add rows for a list taller than the terminal", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const names = Array.from({ length: 60 }, (_, index) => `skill-${index}`);
      const progress = yield* make(names, { tty: true, write: captureWrites(out) });
      yield* progress.setStatus(names[0] ?? "skill-0", "running");
      yield* TestClock.adjust("800 millis");
      const during = yield* Ref.get(out);
      yield* progress.finish;
      expect(during.split("\n").length - 1).toBe(0);
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("non-TTY: prints each terminal status, including unchanged", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["alpha", "beta", "gamma"], {
        tty: false,
        write: captureWrites(out),
      });

      yield* progress.setStatus("alpha", "running");
      yield* progress.setStatus("alpha", "installed");
      yield* progress.setStatus("beta", "running");
      yield* progress.setStatus("beta", "failed");
      yield* progress.setStatus("gamma", "running");
      yield* progress.setStatus("gamma", "unchanged");
      yield* progress.finish;

      const text = yield* Ref.get(out);
      expect(text).toContain("installed");
      expect(text).toContain("alpha");
      expect(text).toContain("beta");
      expect(text).toContain("failed");
      expect(text).toContain("gamma");
      expect(text).toContain("unchanged");
      // running/pending should not be printed in non-TTY mode
      expect(text).not.toContain("installing");
      expect(text).not.toContain("pending");
      // no ANSI sequences in non-TTY mode
      expect(text).not.toContain("\x1b[");
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("TTY: keeps an unchanged skill visible after its pending state", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["stable"], {
        tty: true,
        write: captureWrites(out),
      });

      yield* progress.setStatus("stable", "running");
      yield* progress.setStatus("stable", "unchanged");
      yield* progress.finish;

      const text = yield* Ref.get(out);
      expect(text).toContain("· unchanged");
      expect(text).toContain("stable");
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("non-TTY: respects custom runningVerb but never emits it", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["foo"], {
        tty: false,
        write: captureWrites(out),
        runningVerb: "installing",
      });

      yield* progress.setStatus("foo", "running");
      yield* progress.setStatus("foo", "installed");
      yield* progress.finish;

      const text = yield* Ref.get(out);
      expect(text).toContain("installed");
      expect(text).not.toContain("installing");
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("TTY: emits hide-cursor on start and show-cursor on finish", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["x"], {
        tty: true,
        write: captureWrites(out),
      });

      const afterStart = yield* Ref.get(out);
      expect(afterStart).toContain("\x1b[?25l"); // hide cursor

      yield* progress.setStatus("x", "installed");
      yield* progress.finish;

      const final = yield* Ref.get(out);
      expect(final).toContain("\x1b[?25h"); // show cursor
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("TTY: replaces one live row and prints each result once", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["one", "two"], {
        tty: true,
        write: captureWrites(out),
      });

      yield* progress.setStatus("one", "installed");
      yield* progress.finish;

      const text = yield* Ref.get(out);
      expect(text).not.toContain("\x1b[2A");
      expect(text.split("one").length - 1).toBe(1);
      expect(text.split("two").length - 1).toBe(1);
      expect(text).toContain("\x1b[2K"); // clear line
      expect(text).toContain("one");
      expect(text).toContain("two");
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("TTY: applies color escapes (green for installed, red for failed)", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["a", "b"], {
        tty: true,
        write: captureWrites(out),
      });

      yield* progress.setStatus("a", "installed");
      yield* progress.setStatus("b", "failed");
      yield* progress.finish;

      const text = yield* Ref.get(out);
      expect(text).toContain("\x1b[32m"); // green
      expect(text).toContain("\x1b[31m"); // red
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("uses custom runningVerb for spinner phase in TTY mode", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["s"], {
        tty: true,
        write: captureWrites(out),
        runningVerb: "installing",
      });

      yield* progress.setStatus("s", "running");
      yield* progress.finish;

      const text = yield* Ref.get(out);
      expect(text).toContain("installing");
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("finish stops the ticker and ignores repeated finish or status calls", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["a"], { tty: true, write: captureWrites(out) });
      yield* progress.finish;
      const before = yield* Ref.get(out);
      yield* TestClock.adjust("800 millis");
      yield* progress.finish;
      yield* progress.setStatus("a", "installed");
      expect(yield* Ref.get(out)).toBe(before);
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("TTY: live output stays within a narrow terminal", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["a-very-long-skill-name"], {
        tty: true,
        columns: 12,
        write: captureWrites(out),
      });
      yield* TestClock.adjust("160 millis");
      const during = yield* Ref.get(out);
      yield* progress.finish;
      const plain = Bun.stripANSI(during);
      for (const frame of plain.split("\r")) expect(frame.length).toBeLessThan(12);
      expect(during).not.toContain("\n");
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("TTY: concurrent completions produce one permanent row per skill", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const names = Array.from({ length: 60 }, (_, index) => `skill-${index}`);
      const progress = yield* make(names, { tty: true, write: captureWrites(out) });
      yield* Effect.forEach(names, (name) => progress.setStatus(name, "updated"), {
        concurrency: 8,
      });
      yield* progress.setStatus("skill-0", "updated");
      yield* progress.finish;
      const text = yield* Ref.get(out);
      expect(text.split("\n").length - 1).toBe(names.length);
      for (const name of names) expect(text.split(`${name}\x1b[0m\n`).length - 1).toBe(1);
    }).pipe(Effect.provide(TestStdio)),
  );

  it.effect("renders all skill names provided at make()", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["alpha", "beta", "gamma"], {
        tty: true,
        write: captureWrites(out),
      });
      yield* progress.finish;

      const text = yield* Ref.get(out);
      expect(text).toContain("alpha");
      expect(text).toContain("beta");
      expect(text).toContain("gamma");
    }).pipe(Effect.provide(TestStdio)),
  );
});
