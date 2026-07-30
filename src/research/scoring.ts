import type { Direction } from "./types.js";

/** "minimize" / "maximize" — the verb form used in prompts and reports. */
export const describeDirection = (direction: Direction): string => {
  if (direction === "min") return "minimize";
  return "maximize";
};

/** "lower is better" / "higher is better" — the comparative form. */
export const describeDirectionComparative = (direction: Direction): string => {
  if (direction === "min") return "lower is better";
  return "higher is better";
};

/** Renders a metric value with its unit, or "N/A" when the trial produced none. */
export const formatMetricValue = (value: number | undefined, unit: string): string => {
  if (value === undefined) return "N/A";
  return `${value} ${unit}`;
};

export const compareMetrics = (
  current: number,
  best: number,
  direction: Direction,
): "better" | "worse" | "equal" => {
  if (current === best) return "equal";
  if (direction === "min") {
    if (current < best) return "better";
    return "worse";
  }
  if (current > best) return "better";
  return "worse";
};

export const shouldKeep = (direction: Direction, current: number, best: number): boolean =>
  compareMetrics(current, best, direction) === "better";

/** Renders " <unit>" for a non-empty unit, or "" so captions read cleanly without one. */
export const formatUnitSuffix = (unit: string): string => {
  if (unit === "") return "";
  return ` ${unit}`;
};
