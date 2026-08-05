import packageJson from "../package.json" with { type: "json" };

export const resolveVersion = (): string => {
  if (typeof __VERSION__ === "undefined") return packageJson.version;
  return __VERSION__;
};
