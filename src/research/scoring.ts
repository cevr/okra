import type { Direction } from "./types.js";

export const compareMetrics = (
  current: number,
  best: number,
  direction: Direction,
): "better" | "worse" | "equal" => {
  if (current === best) return "equal";
  if (direction === "min") return current < best ? "better" : "worse";
  return current > best ? "better" : "worse";
};

export const shouldKeep = (direction: Direction, current: number, best: number): boolean =>
  compareMetrics(current, best, direction) === "better";
