import brainDoc from "../../skills/brain/SKILL.md" with { type: "text" };
import brainMeditateDoc from "../../skills/brain-meditate/SKILL.md" with { type: "text" };
import brainPlanDoc from "../../skills/brain-plan/SKILL.md" with { type: "text" };
import brainReflectDoc from "../../skills/brain-reflect/SKILL.md" with { type: "text" };
import brainReviewDoc from "../../skills/brain-review/SKILL.md" with { type: "text" };
import brainRuminateDoc from "../../skills/brain-ruminate/SKILL.md" with { type: "text" };
import counselDoc from "../../skills/counsel/SKILL.md" with { type: "text" };
import imageDoc from "../../skills/image/SKILL.md" with { type: "text" };
import keysDoc from "../../skills/keys/SKILL.md" with { type: "text" };
import repoDoc from "../../skills/repo/SKILL.md" with { type: "text" };
import researchDoc from "../../skills/research/SKILL.md" with { type: "text" };
import scheduleDoc from "../../skills/schedule/SKILL.md" with { type: "text" };
import skillsDoc from "../../skills/skills/SKILL.md" with { type: "text" };

export interface Topic {
  readonly name: string;
  /** First sentence of the skill's frontmatter description. */
  readonly summary: string;
  /** Full SKILL.md content with the frontmatter block removed. */
  readonly body: string;
}

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export const stripFrontmatter = (content: string): string =>
  content.replace(FRONTMATTER_PATTERN, "").trim();

const extractDescription = (content: string): string => {
  const match = content.match(FRONTMATTER_PATTERN);
  if (match?.[1] === undefined) return "";
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    if (line.slice(0, idx).trim() !== "description") continue;
    return line.slice(idx + 1).trim();
  }
  return "";
};

const firstSentence = (text: string): string => {
  const match = text.match(/^.*?[.!?](?=\s|$)/);
  return (match?.[0] ?? text).trim();
};

const makeTopic = (name: string, doc: string): Topic => ({
  name,
  summary: firstSentence(extractDescription(doc)),
  body: stripFrontmatter(doc),
});

/** Every embedded guide, in the order they appear in `okra how`'s table of contents. */
export const TOPICS: ReadonlyArray<Topic> = [
  makeTopic("schedule", scheduleDoc),
  makeTopic("counsel", counselDoc),
  makeTopic("research", researchDoc),
  makeTopic("brain", brainDoc),
  makeTopic("brain-meditate", brainMeditateDoc),
  makeTopic("brain-plan", brainPlanDoc),
  makeTopic("brain-reflect", brainReflectDoc),
  makeTopic("brain-review", brainReviewDoc),
  makeTopic("brain-ruminate", brainRuminateDoc),
  makeTopic("repo", repoDoc),
  makeTopic("skills", skillsDoc),
  makeTopic("image", imageDoc),
  makeTopic("keys", keysDoc),
];

export const findTopic = (name: string): Topic | undefined =>
  TOPICS.find((topic) => topic.name === name);

/** Topics nested under `name` by naming convention (`brain` → `brain-plan`, ...). */
export const subtopicsOf = (name: string): ReadonlyArray<Topic> =>
  TOPICS.filter((topic) => topic.name.startsWith(`${name}-`));
