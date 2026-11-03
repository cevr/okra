import { Option, Schema } from "effect";

export type Registry = "github" | "npm" | "pypi" | "crates";

export const PackageSpec = Schema.Struct({
  registry: Schema.Literals(["github", "npm", "pypi", "crates"]),
  name: Schema.String,
  version: Schema.OptionFromOptional(Schema.String),
});
export type PackageSpec = typeof PackageSpec.Type;

export const RepoMetadata = Schema.Struct({
  spec: PackageSpec,
  fetchedAt: Schema.String,
  lastAccessedAt: Schema.String,
  sizeBytes: Schema.Finite,
  path: Schema.String,
});
export type RepoMetadata = typeof RepoMetadata.Type;

export const MetadataIndex = Schema.Struct({
  version: Schema.Finite,
  repos: Schema.Array(RepoMetadata),
});
export type MetadataIndex = typeof MetadataIndex.Type;

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const toEpochMs = (isoOrMs: string | number): number => {
  if (typeof isoOrMs === "number") return isoOrMs;
  return Date.parse(isoOrMs);
};

export const formatRelativeTime = (isoOrMs: string | number, nowMs: number): string => {
  const targetMs = toEpochMs(isoOrMs);
  const diffMs = nowMs - targetMs;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${String(diffDays)} days ago`;
  if (diffDays < 30) return `${String(Math.floor(diffDays / 7))} weeks ago`;
  if (diffDays < 365) return `${String(Math.floor(diffDays / 30))} months ago`;
  return `${String(Math.floor(diffDays / 365))} years ago`;
};

const registryPrefix = (registry: Registry): string => {
  if (registry === "github") return "";
  return `${registry}:`;
};

const normalizeName = (spec: PackageSpec): string => {
  if (spec.registry === "github") return spec.name.toLowerCase();
  return spec.name;
};

export const specToString = (spec: PackageSpec): string => {
  const prefix = registryPrefix(spec.registry);
  const version = Option.match(spec.version, {
    onNone: () => "",
    onSome: (v) => `@${v}`,
  });
  return `${prefix}${spec.name}${version}`;
};

export const specMatches = (a: PackageSpec, b: PackageSpec): boolean => {
  if (a.registry !== b.registry) return false;
  const aName = normalizeName(a);
  const bName = normalizeName(b);
  if (aName !== bName) return false;
  const aVersion = Option.getOrElse(a.version, () => "");
  const bVersion = Option.getOrElse(b.version, () => "");
  return aVersion === bVersion;
};
