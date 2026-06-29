import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Schema } from "effect";
import { ConfigService } from "../services/Config.js";
import { VaultService } from "../services/Vault.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

const ListOutput = Schema.Struct({
  vault: Schema.String,
  files: Schema.Array(Schema.String),
});
const encodeListOutput = Schema.encodeSync(Schema.fromJsonString(ListOutput));

export const list = Command.make("list", { json: jsonFlag }).pipe(
  Command.withDescription("List vault files"),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const vault = yield* VaultService;

      const vaultPath = yield* config.activeVaultPath;
      const files = yield* vault.listFiles(vaultPath);

      if (json) {
        yield* Console.log(encodeListOutput({ vault: vaultPath, files }));
      } else {
        for (const file of files) {
          yield* Console.log(file);
        }
      }
    }),
  ),
);
