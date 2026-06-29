import { Command } from "effect/unstable/cli";
import { KeyStoreService } from "../shared/keystore.js";
import { keysRoot } from "./commands/index.js";

// KeyStoreService requires FileSystem | Path, which bubble up to the root
// PlatformLayer (BunServices).
export const keysCommand = keysRoot.pipe(Command.provide(KeyStoreService.layer));

export { isKeysError } from "./errors.js";
