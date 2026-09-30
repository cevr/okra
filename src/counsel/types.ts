import { Schema } from "effect";
import { Provider } from "../shared/provider.js";

export { Provider };

export const Profile = Schema.Literals(["standard", "deep"]);
export type Profile = typeof Profile.Type;

export const PromptSource = Schema.Literals(["inline", "file", "stdin"]);
export type PromptSource = typeof PromptSource.Type;

export const RunStatus = Schema.Literals(["success", "error", "timeout"]);
export type RunStatus = typeof RunStatus.Type;

export interface Invocation {
  readonly cmd: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  /** The model passed to the CLI: a codex model id, or a claude alias such as `opus`. */
  readonly model: string;
}

export interface ExecutionResult {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

export const InvocationPreview = Schema.Struct({
  cmd: Schema.String,
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  model: Schema.String,
});
export type InvocationPreview = typeof InvocationPreview.Type;

export const RunManifest = Schema.Struct({
  timestamp: Schema.String,
  slug: Schema.String,
  cwd: Schema.String,
  outputBucket: Schema.String,
  promptSource: PromptSource,
  source: Provider,
  target: Provider,
  profile: Profile,
  status: RunStatus,
  /**
   * The model that ran the last attempt: claude's reported model (e.g. `claude-opus-5-5` for the
   * `opus` alias) when its events name one, else the model passed to the CLI. After a codex
   * fallback it names the fallback model.
   */
  model: Schema.String,
  /** Why the run did not answer (usage limit, API error, no answer); absent on success. */
  failure: Schema.optional(Schema.String),
  exitCode: Schema.Finite,
  durationMs: Schema.Finite,
  promptFilePath: Schema.String,
  outputFile: Schema.String,
  stderrFile: Schema.String,
  eventsFile: Schema.String,
});
export type RunManifest = typeof RunManifest.Type;

export const RunManifestJson = Schema.fromJsonString(RunManifest);
export const encodeRunManifest = Schema.encodeEffect(RunManifestJson);

export const DryRunPreview = Schema.Struct({
  source: Provider,
  target: Provider,
  profile: Profile,
  promptSource: PromptSource,
  outputBucket: Schema.String,
  outputDir: Schema.String,
  promptFilePath: Schema.String,
  invocation: InvocationPreview,
});
export type DryRunPreview = typeof DryRunPreview.Type;

export const DryRunPreviewJson = Schema.fromJsonString(DryRunPreview);
export const encodeDryRunPreview = Schema.encodeEffect(DryRunPreviewJson);
