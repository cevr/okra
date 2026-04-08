import { Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { scheduleRoot } from "./commands/index.js";
import { StoreService } from "./services/Store.js";
import { LaunchdService } from "./services/Launchd.js";
import { AgentPlatformService } from "./services/AgentPlatform.js";

const ScheduleServiceLayer = Layer.mergeAll(
  StoreService.layer,
  LaunchdService.layer,
  AgentPlatformService.layer,
);

export const scheduleCommand = scheduleRoot.pipe(Command.provide(ScheduleServiceLayer));
