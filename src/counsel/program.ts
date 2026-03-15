import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { VERSION } from "./constants.js";
import { counselCommandDef } from "./commands/index.js";
import { encodeErrorPayload, ErrorCode } from "./errors.js";
import type { CounselError } from "./errors.js";
import { HostService } from "./services/Host.js";

const LONG_VALUE_FLAGS = new Set(["--file", "--from", "--output-dir", "--log-level"]);
const SHORT_VALUE_FLAGS = new Set(["-f", "-o"]);
const VALID_FROM = new Set(["claude", "codex"]);
const VALID_COMPLETIONS = new Set(["bash", "zsh", "fish", "sh"]);
const VALID_LOG_LEVELS = new Set([
  "all",
  "trace",
  "debug",
  "info",
  "warn",
  "warning",
  "error",
  "fatal",
  "none",
]);

export const normalizeVersionAlias = (args: ReadonlyArray<string>): ReadonlyArray<string> => {
  let treatRestAsArgs = false;

  return args.map((token) => {
    if (treatRestAsArgs) {
      return token;
    }

    if (token === "--") {
      treatRestAsArgs = true;
      return token;
    }

    return token === "-V" ? "--version" : token;
  });
};

const validateChoice = (
  flag: string,
  value: string,
  valid: ReadonlySet<string>,
  expected: string,
): string | undefined =>
  valid.has(value)
    ? undefined
    : `Invalid value for flag ${flag}: "${value}". Expected: ${expected}`;

const readFlagValue = (
  args: ReadonlyArray<string>,
  index: number,
  token: string,
): { readonly nextIndex: number; readonly value: string } | string => {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex !== -1) {
    const value = token.slice(equalsIndex + 1);
    return value.length === 0
      ? `Missing value for flag ${token.slice(0, equalsIndex)}.`
      : { nextIndex: index, value };
  }

  const next = args[index + 1];
  return next === undefined
    ? `Missing value for flag ${token}.`
    : { nextIndex: index + 1, value: next };
};

export const validateArgs = (args: ReadonlyArray<string>): string | undefined => {
  let positionalCount = 0;
  let treatRestAsArgs = false;

  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === undefined) {
      break;
    }

    if (treatRestAsArgs) {
      positionalCount++;
      if (positionalCount > 1) {
        return "Too many arguments. Expected at most 1 prompt.";
      }
      continue;
    }

    if (token === "--") {
      treatRestAsArgs = true;
      continue;
    }

    if (
      token === "--deep" ||
      token === "--dry-run" ||
      token === "--help" ||
      token === "-h" ||
      token === "--version"
    ) {
      continue;
    }

    if (token === "--completions" || token.startsWith("--completions=")) {
      const value = readFlagValue(args, index, token);
      if (typeof value === "string") {
        return value;
      }
      index = value.nextIndex;
      const error = validateChoice(
        "--completions",
        value.value,
        VALID_COMPLETIONS,
        `"bash" | "zsh" | "fish" | "sh"`,
      );
      if (error !== undefined) {
        return error;
      }
      continue;
    }

    if (token === "--log-level" || token.startsWith("--log-level=")) {
      const value = readFlagValue(args, index, token);
      if (typeof value === "string") {
        return value;
      }
      index = value.nextIndex;
      const error = validateChoice(
        "--log-level",
        value.value,
        VALID_LOG_LEVELS,
        `"all" | "trace" | "debug" | "info" | "warn" | "warning" | "error" | "fatal" | "none"`,
      );
      if (error !== undefined) {
        return error;
      }
      continue;
    }

    if (token === "--from" || token.startsWith("--from=")) {
      const value = readFlagValue(args, index, token);
      if (typeof value === "string") {
        return value;
      }
      index = value.nextIndex;
      const error = validateChoice("--from", value.value, VALID_FROM, `"claude" | "codex"`);
      if (error !== undefined) {
        return error;
      }
      continue;
    }

    if (
      token === "--file" ||
      token === "-f" ||
      token === "--output-dir" ||
      token === "-o" ||
      token.startsWith("--file=") ||
      token.startsWith("--output-dir=")
    ) {
      const value = readFlagValue(args, index, token);
      if (typeof value === "string") {
        return value;
      }
      index = value.nextIndex;
      continue;
    }

    if (
      token.startsWith("--") ||
      LONG_VALUE_FLAGS.has(token) ||
      SHORT_VALUE_FLAGS.has(token) ||
      token.startsWith("-")
    ) {
      return `Unrecognized flag: ${token} in command counsel`;
    }

    positionalCount++;
    if (positionalCount > 1) {
      return "Too many arguments. Expected at most 1 prompt.";
    }
  }

  return undefined;
};

const handleKnownError = (error: CounselError) =>
  Effect.gen(function* () {
    const host = yield* HostService;
    const encoded = yield* encodeErrorPayload({
      error: "CounselError",
      code: error.code,
      message: error.message,
    });
    yield* Console.log(encoded);

    yield* host.setExitCode(
      error.code === ErrorCode.CLI_USAGE_ERROR ||
        error.code === ErrorCode.AMBIGUOUS_PROVIDER ||
        error.code === ErrorCode.FILE_READ_FAILED ||
        error.code === ErrorCode.PROMPT_CONFLICT ||
        error.code === ErrorCode.PROMPT_MISSING
        ? 2
        : error.code === ErrorCode.TARGET_NOT_INSTALLED
          ? 127
          : 1,
    );
  });

export const runCounsel = (rawArgs: ReadonlyArray<string>) => {
  const args = normalizeVersionAlias(rawArgs);
  const usageError = validateArgs(args);

  if (usageError !== undefined) {
    return Effect.gen(function* () {
      const host = yield* HostService;
      const encoded = yield* encodeErrorPayload({
        error: "CliUsageError",
        code: ErrorCode.CLI_USAGE_ERROR,
        message: usageError,
      });
      yield* Console.log(encoded);
      yield* host.setExitCode(2);
    });
  }

  return Command.runWith(counselCommandDef, { version: VERSION })(args).pipe(
    Effect.tapDefect((defect) => Console.error(`Internal error: ${String(defect)}`)),
    Effect.catchTag("CounselError", handleKnownError),
  );
};
