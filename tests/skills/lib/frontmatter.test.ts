import { describe, expect, it } from "effect-bun-test";
import { Effect } from "effect";
import { parseFrontmatter } from "../../../src/skills/lib/frontmatter.js";

describe("parseFrontmatter", () => {
  it.effect("parses valid frontmatter", () =>
    Effect.gen(function* () {
      const content = `---
name: my-skill
description: A test skill
---

# My Skill

Some content here.`;

      const result = yield* parseFrontmatter(content);
      expect(result.name).toBe("my-skill");
      expect(result.description).toBe("A test skill");
    }),
  );

  it.effect("fails on missing fields", () =>
    Effect.gen(function* () {
      const content = `---
name: my-skill
---

# No description`;

      const result = yield* parseFrontmatter(content).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      expect(result).toBe(null);
    }),
  );

  it.effect("fails on no frontmatter", () =>
    Effect.gen(function* () {
      const content = "# Just a heading\n\nSome content.";

      const result = yield* parseFrontmatter(content).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      expect(result).toBe(null);
    }),
  );

  it.effect("handles extra fields gracefully", () =>
    Effect.gen(function* () {
      const content = `---
name: test-skill
description: A test
license: MIT
metadata:
  author: test
---

Content`;

      const result = yield* parseFrontmatter(content);
      expect(result.name).toBe("test-skill");
      expect(result.description).toBe("A test");
    }),
  );
});
