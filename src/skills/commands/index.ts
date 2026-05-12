import { Argument, Command } from "effect/unstable/cli";
import { Config, ConfigProvider, Console, Effect, Option, Path } from "effect";
import { SkillStore } from "../services/SkillStore.js";
import { SkillLock } from "../services/SkillLock.js";
import { runSearch } from "./search.js";
import { runAdd } from "./add.js";
import { runRemove } from "./remove.js";
import { runUpdate } from "./update.js";

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

const readNoColor = Config.option(Config.string("NO_COLOR"))
  .parse(ConfigProvider.fromEnv())
  .pipe(
    Effect.map(Option.isSome),
    Effect.catch(() => Effect.succeed(false)),
  );

const skillsCommand = Command.make("skills", {}, () =>
  Effect.gen(function* () {
    const noColor = yield* readNoColor;
    const isTty: boolean = process.stdout.isTTY ?? false;
    const color = isTty && !noColor;
    const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s);
    const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s);

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

const sourcesArg = Argument.string("source").pipe(Argument.variadic({ min: 1 }));
const namesArg = Argument.string("name").pipe(Argument.variadic({ min: 1 }));
const queryArg = Argument.string("query");

const ADD_DESCRIPTION = `Install one or more skills from GitHub, search query, or local path

Examples:
  okra skills add owner/repo                # all skills from repo (multi-select)
  okra skills add owner/repo@name           # specific skill
  okra skills add .                         # current directory (multi-select if many)
  okra skills add ~/path/to/skill           # local path
  okra skills add owner/a owner/b ./local   # multiple at once`;

const REMOVE_DESCRIPTION = `Remove one or more installed skills

Examples:
  okra skills remove my-skill
  okra skills remove a b c
  okra skills remove ./path/with/skills`;

// Aliases: same handler, multiple subcommand names. effect/cli's Command.withAlias
// only supports a single alias per command, so register parallel commands. The
// canonical command holds the full description; secondary aliases get a short
// pointer to keep `--help` readable.
const makeAdd = (name: string, description: string, alias?: string) => {
  const cmd = Command.make(name, { sources: sourcesArg }, ({ sources }) => runAdd(sources)).pipe(
    Command.withDescription(description),
  );
  return alias === undefined ? cmd : cmd.pipe(Command.withAlias(alias));
};

const makeRemove = (name: string, description: string, alias?: string) => {
  const cmd = Command.make(name, { names: namesArg }, ({ names }) => runRemove(names)).pipe(
    Command.withDescription(description),
  );
  return alias === undefined ? cmd : cmd.pipe(Command.withAlias(alias));
};

const addCommand = makeAdd("add", ADD_DESCRIPTION, "i");
const installCommand = makeAdd("install", "Alias of `add`");
const removeCommand = makeRemove("remove", REMOVE_DESCRIPTION, "rm");
const uninstallCommand = makeRemove("uninstall", "Alias of `remove`");

const searchCommand = Command.make("search", { query: queryArg }, ({ query }) =>
  runSearch(query),
).pipe(Command.withDescription("Search skills.sh for skills"));

const updateCommand = Command.make("update", {}, () => runUpdate()).pipe(
  Command.withDescription("Re-fetch all installed skills from their sources"),
);

export const skillsRoot = skillsCommand.pipe(
  Command.withDescription("Manage AI agent skills"),
  Command.withSubcommands([
    addCommand,
    installCommand,
    searchCommand,
    removeCommand,
    uninstallCommand,
    updateCommand,
  ]),
);
