import { Command, Flag } from "effect/unstable/cli";
import { Console, Effect, Schema } from "effect";
import { ConfigService } from "../services/Config.js";
import { VaultService } from "../services/Vault.js";
import { VaultError } from "../errors/index.js";

const jsonFlag = Flag.boolean("json").pipe(Flag.withDescription("Output as JSON"));

const StatusOutput = Schema.Struct({
  vault: Schema.String,
  files: Schema.Number,
  sections: Schema.Record(Schema.String, Schema.Number),
  orphans: Schema.Array(Schema.String),
});
const encodeStatusOutput = Schema.encodeSync(Schema.fromJsonString(StatusOutput));

export const status = Command.make("status", { json: jsonFlag }).pipe(
  Command.withDescription("Show vault status"),
  Command.withHandler(({ json }) =>
    Effect.gen(function* () {
      const config = yield* ConfigService;
      const vault = yield* VaultService;

      const vaultPath = yield* config.activeVaultPath().pipe(
        Effect.catchTag("@cvr/okra/brain/ConfigError", () =>
          Effect.fail(
            new VaultError({
              message: "Vault not initialized — run `okra brain init`",
              code: "NOT_INITIALIZED",
            }),
          ),
        ),
      );
      const result = yield* vault.status(vaultPath).pipe(
        Effect.catchTag("@cvr/okra/brain/VaultError", (e) => {
          if (e.code === "READ_FAILED" || e.code === "NOT_INITIALIZED") {
            return Effect.fail(
              new VaultError({
                message: "Vault not initialized — run `okra brain init`",
                code: "NOT_INITIALIZED",
              }),
            );
          }
          return Effect.fail(e);
        }),
      );

      if (json) {
        yield* Console.log(encodeStatusOutput(result));
      } else {
        yield* Console.log(`Vault: ${result.vault}`);
        yield* Console.log(`Files: ${result.files}`);
        const sectionParts = Object.entries(result.sections)
          .map(([k, v]) => `${k} (${v})`)
          .join(", ");
        yield* Console.log(`Sections: ${sectionParts}`);
        yield* Console.log(`Orphans: ${result.orphans.length}`);
      }
    }),
  ),
);
