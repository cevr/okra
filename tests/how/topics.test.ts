import { describe, expect, it } from "effect-bun-test";
import { Effect } from "effect";
import { findTopic, stripFrontmatter, subtopicsOf, TOPICS } from "../../src/how/topics.js";

describe("how topics", () => {
  it.effect("every topic has a unique name", () =>
    Effect.sync(() => {
      const names = TOPICS.map((topic) => topic.name);
      expect(new Set(names).size).toBe(names.length);
    }),
  );

  it.effect("every topic has a non-empty summary and body", () =>
    Effect.sync(() => {
      for (const topic of TOPICS) {
        expect(topic.summary.length).toBeGreaterThan(0);
        expect(topic.body.length).toBeGreaterThan(0);
      }
    }),
  );

  it.effect("bodies have frontmatter stripped", () =>
    Effect.sync(() => {
      for (const topic of TOPICS) {
        expect(topic.body.startsWith("---")).toBe(false);
      }
    }),
  );

  it.effect("covers every domain subcommand", () =>
    Effect.sync(() => {
      const names = TOPICS.map((topic) => topic.name);
      for (const domain of ["schedule", "counsel", "repo", "skills", "image", "keys"]) {
        expect(names).toContain(domain);
      }
    }),
  );

  it.effect("findTopic resolves known topics and rejects unknown ones", () =>
    Effect.sync(() => {
      expect(findTopic("repo")?.name).toBe("repo");
      expect(findTopic("nope")).toBeUndefined();
    }),
  );

  it.effect("subtopicsOf groups hyphen-nested topics only", () =>
    Effect.sync(() => {
      // No hyphen-nested skills exist right now, so every topic stands alone.
      for (const topic of TOPICS) {
        expect(subtopicsOf(topic.name)).toEqual([]);
      }
    }),
  );

  it.effect("stripFrontmatter removes only a leading frontmatter block", () =>
    Effect.sync(() => {
      expect(stripFrontmatter("---\nname: x\n---\n\n# Title\n")).toBe("# Title");
      expect(stripFrontmatter("# No frontmatter\n")).toBe("# No frontmatter");
    }),
  );
});
