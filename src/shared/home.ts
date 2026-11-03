import { Config, ConfigProvider, Effect, Option } from "effect";

export const readHome: Effect.Effect<string> = Config.option(Config.String("HOME"))
  .parse(ConfigProvider.fromEnv())
  .pipe(
    Effect.map((home) => Option.getOrElse(home, () => "")),
    Effect.orElseSucceed(() => ""),
  );

export const expandHome = (path: string, home: string): string => {
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
  return path;
};

export const collapseHome = (path: string, home: string): string => {
  if (home === "" || home === "/") return path;
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
};
