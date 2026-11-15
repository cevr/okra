// The TypeScript CLI's outputs, recorded once and checked in. The ported CLI
// is checked against these records; the TypeScript source is gone. A record
// is one reference result per case, keyed by the suite, the seed and the case.
//
// Recording needs the TypeScript CLI, so it ran only at the commit that still
// had it (see parity/frozen/README.md). A check that meets a case with no
// record fails and names it, and a full run (no --case) fails when a record
// is never used, so the corpus and its records cannot drift apart.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function frozen(suite: string, seed: number | string, selected: boolean) {
  const path = join(import.meta.dir, "frozen", `${suite}-${seed}.json`);
  const recording = process.env.OKRA_PARITY_RECORD === "1";
  if (!recording && !existsSync(path))
    throw new Error(`no frozen reference ${path}: seeds recorded are the files in parity/frozen`);
  const table: Record<string, unknown> = recording ? {} : JSON.parse(readFileSync(path, "utf8"));
  const used = new Set<string>();
  return {
    recording,
    // The recorded case keys, in record order (none while recording).
    keys: () => Object.keys(table),
    async get<T>(key: string, record: () => Promise<T>): Promise<T> {
      if (used.has(key)) throw new Error(`${suite}: case key ${key} is not unique`);
      used.add(key);
      if (recording) {
        const value = await record();
        table[key] = value;
        return JSON.parse(JSON.stringify(value)) as T;
      }
      if (!(key in table)) throw new Error(`${suite} seed ${seed}: no frozen reference for ${key}`);
      return JSON.parse(JSON.stringify(table[key])) as T;
    },
    // Writes the records, or checks that a full run used every one.
    done() {
      if (recording) {
        writeFileSync(path, `${JSON.stringify(table, null, 1)}\n`);
        return;
      }
      if (selected) return;
      const unused = Object.keys(table).filter((key) => !used.has(key));
      if (unused.length)
        throw new Error(`${suite} seed ${seed}: records no case reached: ${unused.join(", ")}`);
    },
  };
}
