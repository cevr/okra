import { Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { skillsRoot } from "./commands/index.js";
import { SkillStoreLive } from "./services/SkillStore.js";
import { SkillLockLive } from "./services/SkillLock.js";
import { GitHub } from "./services/GitHub.js";

const SkillsServiceLayer = SkillLockLive.pipe(
  Layer.provideMerge(SkillStoreLive),
  Layer.provideMerge(GitHub.layer),
);

export const skillsCommand = skillsRoot.pipe(Command.provide(SkillsServiceLayer));
