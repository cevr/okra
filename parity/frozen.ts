// The TypeScript CLI's outputs, recorded once and checked in (see
// parity/frozen/README.md). The port is checked against these records; the
// TypeScript source is gone. A record is one reference result per case, keyed
// by the suite, the seed and the case.
//
// A check that meets a case with no record fails and names it, and a full run
// (no --case) fails when a record is never used, so the corpus and its records
// cannot drift apart.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function frozen(suite: string, seed: number | string, selected: boolean) {
  const path = join(import.meta.dir, "frozen", `${suite}-${seed}.json`);
  if (!existsSync(path))
    throw new Error(
      `no frozen reference ${path}: the recorded seeds are the files in parity/frozen`,
    );
  const table: Record<string, unknown> = JSON.parse(readFileSync(path, "utf8"));
  const used = new Set<string>();
  return {
    // The recorded case keys, in record order.
    keys: () => Object.keys(table),
    get<T>(key: string): T {
      if (used.has(key)) throw new Error(`${suite}: case key ${key} is not unique`);
      used.add(key);
      if (!(key in table)) throw new Error(`${suite} seed ${seed}: no frozen reference for ${key}`);
      return structuredClone(table[key]) as T;
    },
    // Checks that a full run used every record.
    done() {
      if (selected) return;
      const unused = Object.keys(table).filter((key) => !used.has(key));
      if (unused.length)
        throw new Error(`${suite} seed ${seed}: records no case reached: ${unused.join(", ")}`);
    },
  };
}
