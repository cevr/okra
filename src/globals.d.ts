declare const __VERSION__: string;
declare const __ASSET_ROOT__: string;

// Markdown files imported `with { type: "text" }` — Bun embeds them as strings
// in both `bun run dev` and the compiled binary.
declare module "*.md" {
  const content: string;
  export default content;
}
