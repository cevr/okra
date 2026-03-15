import { Layer } from "effect";
import { scheduleRoot } from "./commands/index.js";
import { StoreService } from "./services/Store.js";
import { LaunchdService } from "./services/Launchd.js";
import { AgentPlatformService } from "./services/AgentPlatform.js";

export const scheduleCommand = scheduleRoot;

export const ScheduleServiceLayer = Layer.mergeAll(
  StoreService.layer,
  LaunchdService.layer,
  AgentPlatformService.layer,
);
