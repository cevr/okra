import { Schema } from "effect";

export const Provider = Schema.Literals(["claude", "codex"]);
export type Provider = typeof Provider.Type;
