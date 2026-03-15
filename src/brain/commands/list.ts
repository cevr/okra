import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect } from "effect";
import { ConfigService } from "../services/Config.js";
import { VaultService } from "../services/Vault.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

export const list = Command.make("list", { json: jsonFlag }).pipe(
  Command.withDescription("List vault files"),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const vault = yield* VaultService;

      const vaultPath = yield* config.activeVaultPath();
      const files = yield* vault.listFiles(vaultPath);

      if (json) {
        // @effect-diagnostics-next-line effect/preferSchemaOverJson:off
        yield* Console.log(JSON.stringify({ vault: vaultPath, files }));
      } else {
        for (const file of files) {
          yield* Console.log(file);
        }
      }
    }),
  ),
);
