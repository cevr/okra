import { Console, Effect, Option } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { HowError } from "../errors.js";
import { findTopic, subtopicsOf, TOPICS, type Topic } from "../topics.js";

const topicArgument = Argument.string("topic").pipe(
  Argument.withDescription("Topic to explain; omit to list all topics"),
  Argument.optional,
);

const renderToc = (): string => {
  const width = Math.max(...TOPICS.map((topic) => topic.name.length));
  const rows = TOPICS.map((topic) => `  ${topic.name.padEnd(width)}  ${topic.summary}`);
  return [
    "okra — AI agent orchestration toolkit",
    "",
    "Topics:",
    ...rows,
    "",
    "Run `okra how <topic>` for the full guide.",
  ].join("\n");
};

const renderTopic = (topic: Topic): string => {
  const subtopics = subtopicsOf(topic.name);
  if (subtopics.length === 0) return topic.body;
  const names = subtopics.map((sub) => sub.name).join(", ");
  return `${topic.body}\n\nSubtopics: ${names} — run \`okra how <subtopic>\` for details.`;
};

/** `okra how [<topic>]` — progressive disclosure of the embedded skill guides. */
export const howRoot = Command.make("how", { topic: topicArgument }, ({ topic }) =>
  Option.match(topic, {
    onNone: () => Console.log(renderToc()),
    onSome: (name) => {
      const found = findTopic(name);
      if (found === undefined) {
        const available = TOPICS.map((t) => t.name).join(", ");
        return Effect.fail(
          HowError.make({
            message: `Unknown topic '${name}'. Available topics: ${available}`,
            code: "NOT_FOUND",
          }),
        );
      }
      return Console.log(renderTopic(found));
    },
  }),
).pipe(
  Command.withDescription("Print usage guides for okra domains (list topics, or one full guide)"),
);
