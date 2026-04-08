// @effect-diagnostics effect/strictBooleanExpressions:off
import { Effect, Option, Schema } from "effect";

export class SkillFrontmatter extends Schema.Class<SkillFrontmatter>("SkillFrontmatter")({
  name: Schema.String,
  description: Schema.String,
}) {}

const decode = Schema.decodeUnknownEffect(SkillFrontmatter);

/**
 * Extract YAML frontmatter from a markdown string.
 * Expects `---` delimited block at start of file with `key: value` lines.
 * Handles YAML folded (`>`) and literal (`|`) block scalars.
 */
export const parseFrontmatter = Effect.fn("parseFrontmatter")(function* (content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match?.[1]) {
    return yield* decode({});
  }

  const record: Record<string, string> = {};
  const lines = match[1].split("\n");
  let currentKey: string | null = null;
  let currentLines: Array<string> = [];
  let inBlock = false;

  const flushBlock = () => {
    if (currentKey && currentLines.length > 0) {
      record[currentKey] = currentLines.join(" ").trim();
    }
    currentKey = null;
    currentLines = [];
    inBlock = false;
  };

  for (const line of lines) {
    // Indented continuation line
    if (inBlock && /^\s+/.test(line)) {
      currentLines.push(line.trim());
      continue;
    }

    // New top-level key
    const idx = line.indexOf(":");
    if (idx === -1) continue;

    flushBlock();

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    // Skip nested YAML objects (e.g. "metadata:")
    if (!key || !value) continue;

    // Block scalar indicator
    if (value === ">" || value === "|") {
      currentKey = key;
      currentLines = [];
      inBlock = true;
      continue;
    }

    record[key] = value;
  }

  flushBlock();

  return yield* decode(record);
});

export const tryParseFrontmatter = Effect.fn("tryParseFrontmatter")(function* (content: string) {
  return yield* parseFrontmatter(content).pipe(
    Effect.map(Option.some),
    Effect.catch(() => Effect.succeed(Option.none())),
  );
});
