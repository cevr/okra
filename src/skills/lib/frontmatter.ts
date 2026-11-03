import { Effect, Option, Schema } from "effect";

export class SkillFrontmatter extends Schema.Class<
  SkillFrontmatter,
  { readonly brand: unique symbol }
>("SkillFrontmatter")({
  name: Schema.String,
  description: Schema.String,
}) {}

const decode = Schema.decodeUnknownEffect(SkillFrontmatter);

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
    if (inBlock && /^\s+/.test(line)) {
      currentLines.push(line.trim());
      continue;
    }

    const idx = line.indexOf(":");
    if (idx === -1) continue;

    flushBlock();

    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    if (!key || !value) continue;

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
    Effect.asSome,
    Effect.orElseSucceed(() => Option.none()),
  );
});
