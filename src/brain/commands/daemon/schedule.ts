import { Option } from "effect";
import type { DaemonJob } from "./launchd.js";

/** 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat (JS Date.getDay()) */
export interface TickInput {
  readonly day: number;
  readonly hour: number;
}

/**
 * Determine which daemon job to run for the current tick.
 * Returns None when no job should run.
 *
 * Schedule:
 * - Fri(5)/Sat(6): skip all
 * - 9am Sunday(0): meditate (weekly)
 * - 9am Mon(1)-Thu(4): ruminate (daily)
 * - 13/17/21 Sun(0)-Thu(4): reflect
 */
export const resolveJob = (input: TickInput): Option.Option<DaemonJob> => {
  const { day, hour } = input;

  // Fri/Sat: skip everything
  if (day === 5 || day === 6) return Option.none();

  if (hour === 9) {
    // Sunday 9am: meditate (suppresses ruminate and reflect)
    if (day === 0) return Option.some("meditate");
    // Mon-Thu 9am: ruminate (suppresses reflect)
    return Option.some("ruminate");
  }

  // 13, 17, 21: reflect
  if (hour === 13 || hour === 17 || hour === 21) return Option.some("reflect");

  // Unexpected hour — guard for manual/misconfigured triggers
  return Option.none();
};
