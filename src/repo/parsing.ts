import { Effect, Option } from "effect";
import type { PackageSpec, Registry } from "./types.js";
import { RepoError } from "./errors.js";

export type ParseResult = PackageSpec | { error: string };

export function parseGithubSpec(input: string): ParseResult {
  const refMatch = input.match(/^([^@#]+)[@#](.+)$/);
  if (refMatch !== null) {
    const [, name, ref] = refMatch;
    if (name === undefined || !name.includes("/")) {
      return { error: "GitHub spec must be owner/repo format" };
    }
    return {
      registry: "github" as Registry,
      name: name.toLowerCase(),
      // ref is guaranteed to exist when refMatch matches
      version: Option.some(ref as string),
    };
  }

  if (!input.includes("/")) {
    return { error: "GitHub spec must be owner/repo format" };
  }

  return {
    registry: "github" as Registry,
    name: input.toLowerCase(),
    version: Option.none(),
  };
}

export function parseNpmSpec(input: string): ParseResult {
  if (input.startsWith("@")) {
    const match = input.match(/^(@[^@]+)(?:@(.+))?$/);
    if (match === null) {
      return { error: "Invalid scoped npm package spec" };
    }
    const [, name, version] = match;
    return {
      registry: "npm" as Registry,
      // name is guaranteed to exist when match succeeds
      name: name as string,
      version: version !== undefined ? Option.some(version) : Option.none(),
    };
  }

  const parts = input.split("@");
  if (parts.length > 2) {
    return { error: "Invalid npm package spec" };
  }

  const [name, version] = parts;
  if (name === undefined || name.length === 0) {
    return { error: "Package name is required" };
  }

  return {
    registry: "npm" as Registry,
    name,
    version: version !== undefined ? Option.some(version) : Option.none(),
  };
}

export function parsePypiSpec(input: string): ParseResult {
  const match = input.match(/^([^@=]+)(?:[@=]=?(.+))?$/);
  if (match === null) {
    return { error: "Invalid PyPI package spec" };
  }

  const [, name, version] = match;
  if (name === undefined || name.length === 0) {
    return { error: "Package name is required" };
  }

  return {
    registry: "pypi" as Registry,
    name: name.trim(),
    version: version !== undefined ? Option.some(version.trim()) : Option.none(),
  };
}

export function parseCratesSpec(input: string): ParseResult {
  const parts = input.split("@");
  if (parts.length > 2) {
    return { error: "Invalid crates.io spec" };
  }

  const [name, version] = parts;
  if (name === undefined || name.length === 0) {
    return { error: "Crate name is required" };
  }

  return {
    registry: "crates" as Registry,
    name: name.trim(),
    version: version !== undefined ? Option.some(version.trim()) : Option.none(),
  };
}

/**
 * Parse a package spec string into a PackageSpec.
 * Supports prefixes: npm:, pypi:, pip:, crates:, cargo:, rust:, github:
 * Without prefix: "/" -> GitHub, else npm
 */
export function parseSpecSync(input: string): ParseResult {
  const trimmed = input.trim();

  if (trimmed.startsWith("npm:")) {
    return parseNpmSpec(trimmed.slice(4));
  }
  if (trimmed.startsWith("pypi:") || trimmed.startsWith("pip:")) {
    const prefix = trimmed.startsWith("pypi:") ? "pypi:" : "pip:";
    return parsePypiSpec(trimmed.slice(prefix.length));
  }
  if (
    trimmed.startsWith("crates:") ||
    trimmed.startsWith("cargo:") ||
    trimmed.startsWith("rust:")
  ) {
    const prefixLen = trimmed.indexOf(":") + 1;
    return parseCratesSpec(trimmed.slice(prefixLen));
  }
  if (trimmed.startsWith("github:")) {
    return parseGithubSpec(trimmed.slice(7));
  }

  if (trimmed.includes("/") && !trimmed.startsWith("@")) {
    return parseGithubSpec(trimmed);
  }

  return parseNpmSpec(trimmed);
}

/** Parse spec as Effect, failing with RepoError on invalid input. */
export const parseSpec = (input: string): Effect.Effect<PackageSpec, RepoError> =>
  Effect.sync(() => parseSpecSync(input)).pipe(
    Effect.flatMap((result) => {
      if ("error" in result) {
        return Effect.fail(
          new RepoError({ message: `${result.error}: ${input}`, code: "SPEC_PARSE" }),
        );
      }
      return Effect.succeed(result);
    }),
  );
