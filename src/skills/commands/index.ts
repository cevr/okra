// @effect-diagnostics effect/strictBooleanExpressions:off
import { Argument, Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Option, Path } from "effect";
import { SkillStore } from "../services/SkillStore.js";
import { SkillLock } from "../services/SkillLock.js";
import { runSearch } from "./search.js";
import { runAdd } from "./add.js";
import { runRemove } from "./remove.js";
import { runUpdate } from "./update.js";

const stdoutColor = process.stdout.isTTY && !process.env["NO_COLOR"];
const dim = (s: string) => (stdoutColor ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (stdoutColor ? `\x1b[1m${s}\x1b[0m` : s);
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

const skillsCommand = Command.make("skills", {}, () =>
  Effect.gen(function* () {
    const store = yield* SkillStore;
    const lock = yield* SkillLock;
    const pathService = yield* Path.Path;
    const [skills, lockFile] = yield* Effect.all([store.list, lock.read]);

    const managed = skills.filter((s) => pathService.basename(s.dirPath) in lockFile.skills);
    const unmanagedCount = skills.length - managed.length;

    if (managed.length === 0 && unmanagedCount === 0) {
      yield* Console.log("No skills installed.");
      yield* Console.log("");
      yield* Console.log("Install skills:");
      yield* Console.log("  okra skills add <owner/repo>");
      yield* Console.log("  okra skills add <owner/repo@skill-name>");
      yield* Console.log("  okra skills search <query>");
      return;
    }

    if (managed.length === 0) {
      yield* Console.log("No managed skills.");
    } else {
      yield* Console.log(`${bold(`${managed.length} skill(s) managed`)}\n`);
      for (const skill of managed) {
        yield* Console.log(`  ${bold(skill.name)}`);
        if (skill.description) {
          yield* Console.log(`  ${dim(truncate(skill.description, 80))}`);
        }
        yield* Console.log("");
      }
    }

    if (unmanagedCount > 0) {
      yield* Console.log(dim(`(${unmanagedCount} unmanaged)`));
    }
  }).pipe(Effect.withSpan("command.list")),
);

const sourceArg = Argument.string("source").pipe(Argument.optional);
const queryArg = Argument.string("query");
const nameArg = Argument.string("name");

const skillOption = Flag.string("skill").pipe(
  Flag.withAlias("s"),
  Flag.withDescription("Install a specific skill from a multi-skill repo"),
  Flag.optional,
);

const ADD_DESCRIPTION = `Install a skill from GitHub, search query, or local path

Examples:
  okra skills add owner/repo          # all skills from repo
  okra skills add owner/repo@name     # specific skill
  okra skills add .                   # from current directory
  okra skills add ~/path/to/skill     # from local path`;

const addCommand = Command.make(
  "add",
  { source: sourceArg, skill: skillOption },
  ({ source, skill }) => runAdd(Option.getOrUndefined(source), Option.getOrUndefined(skill)),
).pipe(Command.withDescription(ADD_DESCRIPTION));

const searchCommand = Command.make("search", { query: queryArg }, ({ query }) =>
  runSearch(query),
).pipe(Command.withDescription("Search skills.sh for skills"));

const removeCommand = Command.make("remove", { name: nameArg }, ({ name }) => runRemove(name)).pipe(
  Command.withDescription("Remove an installed skill"),
);

const updateCommand = Command.make("update", {}, () => runUpdate()).pipe(
  Command.withDescription("Re-fetch all installed skills from their sources"),
);

export const skillsRoot = skillsCommand.pipe(
  Command.withDescription("Manage AI agent skills"),
  Command.withSubcommands([addCommand, searchCommand, removeCommand, updateCommand]),
);
