import { Config, ConfigProvider, Effect, Option } from "effect";

/**
 * The user's home directory from the process environment, or "" when HOME is
 * unset. Reads the real environment so a command's own ConfigProvider (such as
 * a test's SKILLS_DIR) does not hide it.
 */
export const readHome: Effect.Effect<string> = Config.option(Config.String("HOME"))
  .parse(ConfigProvider.fromEnv())
  .pipe(
    Effect.map((home) => Option.getOrElse(home, () => "")),
    Effect.orElseSucceed(() => ""),
  );

/** `~` or `~/rest` becomes `<home>/rest`; any other path is returned unchanged. */
export const expandHome = (path: string, home: string): string => {
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
  return path;
};

/** A path under `home` becomes `~/rest`, so it names the same place on every machine. */
export const collapseHome = (path: string, home: string): string => {
  if (home === "" || home === "/") return path;
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
};
