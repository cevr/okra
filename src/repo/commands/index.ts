import { Command } from "effect/unstable/cli";

import { fetch } from "./fetch.js";
import { list } from "./list.js";
import { remove } from "./remove.js";
import { clean } from "./clean.js";
import { path } from "./path.js";

export const repoRoot = Command.make("repo").pipe(
  Command.withDescription("Multi-registry source code cache manager"),
  Command.withSubcommands([fetch, list, remove, clean, path]),
);
