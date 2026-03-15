import { Effect, Layer, Option, ServiceMap } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import { VaultError } from "../errors/index.js";

function isNotFound(e: PlatformError): boolean {
  const tag = e.reason._tag;
  return tag === "NotFound" || tag === "BadArgument";
}

interface VaultStatus {
  readonly vault: string;
  readonly files: number;
  readonly sections: Record<string, number>;
  readonly orphans: string[];
}

interface ReindexResult {
  readonly vault: string;
  readonly files: number;
  readonly sections: Record<string, number>;
  readonly changed: boolean;
}

const VAULT_DIRS = ["principles", "plans", "projects"] as const;

// Seed files that have their own curated indexes — exclude from auto-index "Other" section
const VAULT_SEED_FILES = new Set(["principles"]);

const VAULT_FILES: Record<string, string> = {
  "index.md": `# Brain\n`,
  "principles.md": `# Principles\n`,
  "plans/index.md": `# Plans\n`,
};

function firstCapture(m: RegExpExecArray | RegExpMatchArray): string {
  return m[1] ?? "";
}

function isIndexMd(f: string): boolean {
  return f === "index.md" || f.endsWith("/index.md");
}

function filterMdFiles(entries: string[]): string[] {
  return entries.filter((f) => f.endsWith(".md") && !isIndexMd(f) && !f.includes("node_modules/"));
}

function dirPrefix(f: string): string {
  const slash = f.indexOf("/");
  return slash === -1 ? "" : f.slice(0, slash);
}

function extractSections(files: string[]): Record<string, number> {
  const sections: Record<string, number> = {};
  for (const f of files) {
    const section = dirPrefix(f) || "other";
    sections[section] = (sections[section] ?? 0) + 1;
  }
  return sections;
}

export class VaultService extends ServiceMap.Service<
  VaultService,
  {
    readonly init: (
      vaultPath: string,
      options?: { readonly minimal?: boolean },
    ) => Effect.Effect<string[], VaultError>;
    readonly rebuildIndex: (vaultPath: string) => Effect.Effect<ReindexResult, VaultError>;
    readonly readIndex: (vaultPath: string) => Effect.Effect<string, VaultError>;
    readonly listFiles: (vaultPath: string) => Effect.Effect<string[], VaultError>;
    readonly status: (vaultPath: string) => Effect.Effect<VaultStatus, VaultError>;
    readonly snapshot: (
      dirPath: string,
      outputPath: Option.Option<string>,
    ) => Effect.Effect<string, VaultError>;
  }
>()("@cvr/okra/brain/services/Vault/VaultService") {
  static layer: Layer.Layer<VaultService, never, FileSystem | Path> = Layer.effect(
    VaultService,
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;

      const listMdFiles = Effect.fn("VaultService.listMdFiles")(function* (vaultPath: string) {
        const entries = yield* fs.readDirectory(vaultPath, { recursive: true }).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new VaultError({
                message: `Cannot read vault: ${e.message}`,
                code: "READ_FAILED",
                path: vaultPath,
              }),
          ),
        );
        return filterMdFiles(entries)
          .map((f) => f.replace(/\.md$/, ""))
          .sort();
      });

      const init = Effect.fn("VaultService.init")(function* (
        vaultPath: string,
        options?: { readonly minimal?: boolean },
      ) {
        const created: string[] = [];
        const minimal = options?.minimal === true;

        yield* fs.makeDirectory(vaultPath, { recursive: true }).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new VaultError({
                message: `Cannot create vault: ${e.message}`,
                code: "WRITE_FAILED",
                path: vaultPath,
              }),
          ),
        );

        if (!minimal) {
          for (const dir of VAULT_DIRS) {
            yield* fs.makeDirectory(path.join(vaultPath, dir), { recursive: true }).pipe(
              Effect.mapError(
                (e: PlatformError) =>
                  new VaultError({
                    message: `Cannot create ${dir}: ${e.message}`,
                    code: "WRITE_FAILED",
                    path: vaultPath,
                  }),
              ),
            );
          }
        }

        const filesToCreate = minimal
          ? { "index.md": VAULT_FILES["index.md"] ?? "# Brain\n" }
          : VAULT_FILES;

        for (const [filePath, content] of Object.entries(filesToCreate)) {
          const fullPath = path.join(vaultPath, filePath);
          const exists = yield* fs.exists(fullPath).pipe(
            Effect.mapError(
              (e: PlatformError) =>
                new VaultError({
                  message: `Cannot check ${filePath}: ${e.message}`,
                  code: "READ_FAILED",
                  path: vaultPath,
                }),
            ),
          );
          if (!exists) {
            yield* fs.writeFileString(fullPath, content).pipe(
              Effect.mapError(
                (e: PlatformError) =>
                  new VaultError({
                    message: `Cannot write ${filePath}: ${e.message}`,
                    code: "WRITE_FAILED",
                    path: vaultPath,
                  }),
              ),
            );
            created.push(filePath);
          }
        }

        return created;
      });

      const rebuildIndex = Effect.fn("VaultService.rebuildIndex")(function* (vaultPath: string) {
        const indexPath = path.join(vaultPath, "index.md");

        const allFiles = yield* listMdFiles(vaultPath);
        // Exclude seed files (e.g. principles.md) that have their own curated indexes
        const disk = allFiles.filter((f) => f.includes("/") || !VAULT_SEED_FILES.has(f));

        const existingContent = yield* fs.readFileString(indexPath).pipe(
          Effect.catchIf(isNotFound, () => Effect.succeed("")),
          Effect.mapError(
            (e) =>
              new VaultError({
                message: `Cannot read index: ${(e as PlatformError).message}`,
                code: "INDEX_MISSING",
                path: vaultPath,
              }),
          ),
        );

        // Strip heading anchors (e.g. [[file#heading]] → file) and deduplicate for comparison
        const indexed = [
          ...new Set(
            [...existingContent.matchAll(/\[\[([^\]]+)\]\]/g)].map(
              (m) => firstCapture(m).split("#")[0] ?? "",
            ),
          ),
        ]
          .filter((f) => !VAULT_SEED_FILES.has(f))
          .sort();

        const diskStr = disk.join("\n");
        const indexedStr = indexed.join("\n");
        if (diskStr === indexedStr) {
          return {
            vault: vaultPath,
            files: allFiles.length,
            sections: extractSections(disk),
            changed: false,
          };
        }

        const dirs = extractSections(disk);

        const lines: string[] = ["# Brain"];

        for (const section of Object.keys(dirs).sort()) {
          const files = disk.filter((f) => f.startsWith(`${section}/`));
          if (files.length === 0) continue;
          const header = section.charAt(0).toUpperCase() + section.slice(1);
          lines.push("");
          lines.push(`## ${header}`);
          for (const f of files) {
            lines.push(`- [[${f}]]`);
          }
        }

        const standalone = disk.filter((f) => !f.includes("/"));
        if (standalone.length > 0) {
          lines.push("");
          lines.push("## Other");
          for (const f of standalone) {
            lines.push(`- [[${f}]]`);
          }
        }

        lines.push("");

        yield* fs.writeFileString(indexPath, lines.join("\n")).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new VaultError({
                message: `Cannot write index: ${e.message}`,
                code: "WRITE_FAILED",
                path: vaultPath,
              }),
          ),
        );

        return {
          vault: vaultPath,
          files: allFiles.length,
          sections: extractSections(disk),
          changed: true,
        };
      });

      const readIndex = Effect.fn("VaultService.readIndex")(function* (vaultPath: string) {
        const indexPath = path.join(vaultPath, "index.md");
        return yield* fs.readFileString(indexPath).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new VaultError({
                message: `Cannot read index: ${e.message}`,
                code: "INDEX_MISSING",
                path: vaultPath,
              }),
          ),
        );
      });

      const status = Effect.fn("VaultService.status")(function* (vaultPath: string) {
        const files = yield* listMdFiles(vaultPath);

        const indexContent = yield* fs.readFileString(path.join(vaultPath, "index.md")).pipe(
          Effect.catchIf(isNotFound, () => Effect.succeed("")),
          Effect.mapError(
            (e) =>
              new VaultError({
                message: `Cannot read index: ${(e as PlatformError).message}`,
                code: "INDEX_MISSING",
                path: vaultPath,
              }),
          ),
        );
        const indexed = new Set(
          [...indexContent.matchAll(/\[\[([^\]]+)\]\]/g)].map(
            (m) => firstCapture(m).split("#")[0] ?? "",
          ),
        );
        // Exclude seed files from orphan detection — they have their own curated indexes
        const filesForOrphans = files.filter((f) => f.includes("/") || !VAULT_SEED_FILES.has(f));
        const orphans = filesForOrphans.filter((f) => !indexed.has(f));

        return { vault: vaultPath, files: files.length, sections: extractSections(files), orphans };
      });

      const snapshot = Effect.fn("VaultService.snapshot")(function* (
        dirPath: string,
        outputPath: Option.Option<string>,
      ) {
        const files = yield* fs.readDirectory(dirPath, { recursive: true }).pipe(
          Effect.mapError(
            (e: PlatformError) =>
              new VaultError({
                message: `Cannot read directory: ${e.message}`,
                code: "READ_FAILED",
                path: dirPath,
              }),
          ),
        );

        const mdFiles = filterMdFiles(files).sort();
        const chunks: string[] = [];

        for (const file of mdFiles) {
          const fullPath = path.join(dirPath, file);
          const content = yield* fs.readFileString(fullPath).pipe(
            Effect.mapError(
              (e: PlatformError) =>
                new VaultError({
                  message: `Cannot read ${file}: ${e.message}`,
                  code: "READ_FAILED",
                  path: dirPath,
                }),
            ),
          );
          chunks.push(`=== ${file} ===`);
          chunks.push(content);
          chunks.push("");
        }

        const result = chunks.join("\n");

        if (Option.isSome(outputPath)) {
          // Ensure parent directory exists
          yield* fs.makeDirectory(path.dirname(outputPath.value), { recursive: true }).pipe(
            Effect.mapError(
              (e: PlatformError) =>
                new VaultError({
                  message: `Cannot create output dir: ${e.message}`,
                  code: "WRITE_FAILED",
                  path: outputPath.value,
                }),
            ),
          );
          yield* fs.writeFileString(outputPath.value, result).pipe(
            Effect.mapError(
              (e: PlatformError) =>
                new VaultError({
                  message: `Cannot write snapshot: ${e.message}`,
                  code: "WRITE_FAILED",
                  path: outputPath.value,
                }),
            ),
          );
          return outputPath.value;
        }

        return result;
      });

      return {
        init,
        rebuildIndex,
        readIndex,
        listFiles: listMdFiles,
        status,
        snapshot,
      };
    }),
  );
}
