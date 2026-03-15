import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { startCommand } from "./start.js";
import { stopCommand } from "./stop.js";
import { statusCommand } from "./status.js";
import { logsCommand } from "./logs.js";
import { steerCommand } from "./steer.js";
import { resultsCommand } from "./results.js";
import { loopCommand } from "./loop.js";

export const researchRoot = Command.make("research", {}, () => Effect.void).pipe(
  Command.withDescription("Autonomous experiment daemon — optimize any measurable metric"),
  Command.withSubcommands([
    startCommand,
    stopCommand,
    statusCommand,
    logsCommand,
    steerCommand,
    resultsCommand,
    loopCommand,
  ]),
);
