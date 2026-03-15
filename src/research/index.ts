import { Layer } from "effect";
import { researchRoot } from "./commands/index.js";
import { AgentPlatformService } from "./services/AgentPlatform.js";
import { BudgetService } from "./services/Budget.js";
import { DaemonService } from "./services/Daemon.js";
import { ExperimentLogService } from "./services/ExperimentLog.js";
import { GitService } from "./services/Git.js";
import { LoopService } from "./services/Loop.js";
import { RunnerService } from "./services/Runner.js";
import { SessionService } from "./services/Session.js";
import { WorkspaceService } from "./services/Workspace.js";

export const researchCommand = researchRoot;

// Base services with no inter-service dependencies
const BaseLayer = Layer.mergeAll(
  AgentPlatformService.layer,
  BudgetService.layer,
  DaemonService.layer,
  ExperimentLogService.layer,
  GitService.layer,
  RunnerService.layer,
  SessionService.layer,
);

// WorkspaceService depends on GitService
// LoopService depends on all other services
export const ResearchServiceLayer = LoopService.layer.pipe(
  Layer.provideMerge(WorkspaceService.layer.pipe(Layer.provideMerge(BaseLayer))),
);
