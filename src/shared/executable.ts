// @effect-diagnostics effect/nodeBuiltinImport:off
import { existsSync } from "node:fs";

export const resolveExecutable = (name: string): string => {
  const path = Bun.which(name);
  if (path !== null) return path;
  // Fallback: check common locations when PATH is incomplete (e.g. daemon context)
  const home = process.env["HOME"] ?? "";
  const candidates = [
    `${home}/.bun/bin/${name}`,
    `/usr/local/bin/${name}`,
    `${home}/.local/bin/${name}`,
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return name;
};
