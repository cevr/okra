import { Command } from "effect/cli";
import { KeyStoreService } from "../shared/keystore.js";
import { keysRoot } from "./commands/index.js";

export const keysCommand = keysRoot.pipe(Command.provide(KeyStoreService.layer));

export { isKeysError } from "./errors.js";
