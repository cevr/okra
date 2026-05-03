import { describe, expect, it } from "effect-bun-test";
import { Effect, Ref } from "effect";
import { make } from "../../../src/skills/lib/progress.js";

const captureWrites = (output: Ref.Ref<string>) => (text: string) =>
  Ref.update(output, (current) => current + text);

describe("progress", () => {
  it.effect("non-TTY: only prints terminal statuses (no pending/running)", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["alpha", "beta"], {
        tty: false,
        write: captureWrites(out),
      });

      yield* progress.setStatus("alpha", "running");
      yield* progress.setStatus("alpha", "installed");
      yield* progress.setStatus("beta", "running");
      yield* progress.setStatus("beta", "failed");
      yield* progress.finish;

      const text = yield* Ref.get(out);
      expect(text).toContain("installed");
      expect(text).toContain("alpha");
      expect(text).toContain("beta");
      expect(text).toContain("failed");
      // running/pending should not be printed in non-TTY mode
      expect(text).not.toContain("installing");
      expect(text).not.toContain("pending");
      // no ANSI sequences in non-TTY mode
      expect(text).not.toContain("\x1b[");
    }),
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
    }),
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
    }),
  );

  it.effect("TTY: redraws use cursor-up + clear-line ANSI", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["one", "two"], {
        tty: true,
        write: captureWrites(out),
      });

      yield* progress.setStatus("one", "installed");
      yield* progress.finish;

      const text = yield* Ref.get(out);
      // 2 entries → cursor up by 2 between redraws
      expect(text).toContain("\x1b[2A");
      expect(text).toContain("\x1b[2K"); // clear line
      expect(text).toContain("one");
      expect(text).toContain("two");
    }),
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
    }),
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
    }),
  );

  it.live("finish stops the ticker (no more writes after finish)", () =>
    Effect.gen(function* () {
      const out = yield* Ref.make("");
      const progress = yield* make(["a"], {
        tty: true,
        write: captureWrites(out),
      });

      yield* progress.finish;
      const beforeSleep = (yield* Ref.get(out)).length;

      // Wait longer than ticker interval (80ms) to verify it stopped
      yield* Effect.sleep("200 millis");
      const afterSleep = (yield* Ref.get(out)).length;

      expect(afterSleep).toBe(beforeSleep);
    }),
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
    }),
  );
});
