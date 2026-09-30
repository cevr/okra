import { Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { CodexModelsService } from "../shared/codex-models.js";
import { ModelCatalogService } from "../shared/model-catalog.js";
import { counselCommandDef } from "./commands/index.js";
import { AgentPlatformService } from "./services/AgentPlatform.js";
import { HostService } from "./services/Host.js";
import { InvocationRunnerService } from "./services/InvocationRunner.js";
import { RunService } from "./services/Run.js";

const AgentPlatformLayer = AgentPlatformService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(HostService.layer, CodexModelsService.layer, ModelCatalogService.layer),
  ),
);

export const CounselServiceLayer = RunService.layer.pipe(
  Layer.provideMerge(InvocationRunnerService.layer),
  Layer.provideMerge(AgentPlatformLayer),
  Layer.provideMerge(HostService.layer),
);

// Counsel uses its own command definition directly as the subcommand.
// CounselError handling happens in the root main.ts error handler.
export const counselCommand = counselCommandDef.pipe(Command.provide(CounselServiceLayer));
