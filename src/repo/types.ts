import { Option, Schema } from "effect";

// Registry types
export type Registry = "github" | "npm" | "pypi" | "crates";

// Package spec - identifies a package/repo across registries
export const PackageSpec = Schema.Struct({
  registry: Schema.Literals(["github", "npm", "pypi", "crates"]),
  name: Schema.String,
  version: Schema.OptionFromOptional(Schema.String),
});
export type PackageSpec = typeof PackageSpec.Type;

// Metadata stored per-cached entry
export const RepoMetadata = Schema.Struct({
  spec: PackageSpec,
  fetchedAt: Schema.String,
  lastAccessedAt: Schema.String,
  sizeBytes: Schema.Number,
  path: Schema.String,
});
export type RepoMetadata = typeof RepoMetadata.Type;

// Global metadata index
export const MetadataIndex = Schema.Struct({
  version: Schema.Number,
  repos: Schema.Array(RepoMetadata),
});
export type MetadataIndex = typeof MetadataIndex.Type;

// Utility to format bytes
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

// Utility to format relative time
export const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

// Spec display helper
export const specToString = (spec: PackageSpec): string => {
  const prefix = spec.registry === "github" ? "" : `${spec.registry}:`;
  const version = Option.match(spec.version, {
    onNone: () => "",
    onSome: (v) => `@${v}`,
  });
  return `${prefix}${spec.name}${version}`;
};

// Shared spec matching logic — case-insensitive for GitHub
export const specMatches = (a: PackageSpec, b: PackageSpec): boolean => {
  if (a.registry !== b.registry) return false;
  const aName = a.registry === "github" ? a.name.toLowerCase() : a.name;
  const bName = b.registry === "github" ? b.name.toLowerCase() : b.name;
  if (aName !== bName) return false;
  const aVersion = Option.getOrElse(a.version, () => "");
  const bVersion = Option.getOrElse(b.version, () => "");
  return aVersion === bVersion;
};
