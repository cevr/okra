import type { ExperimentState, ResultEvent, Session, SteerEvent } from "./types.js";

export const buildExperimentPrompt = (
  session: Session,
  state: ExperimentState,
  worktreePath: string,
  sourcePath: string,
  steers: ReadonlyArray<SteerEvent>,
): string => {
  const lines: Array<string> = [];

  lines.push(`# Experiment: ${session.name}`);
  lines.push("");
  lines.push(`## Objective`);
  lines.push(session.objective);
  lines.push("");
  lines.push(
    `## Goal: ${session.direction === "min" ? "minimize" : "maximize"} (${session.unit || "unitless"})`,
  );
  lines.push("");

  if (state.best !== undefined) {
    lines.push(`## Current Best`);
    lines.push(`- **Value**: ${state.best.value} ${session.unit}`);
    lines.push(`- **Iteration**: ${state.best.iteration}`);
    if (state.best.summary !== undefined) {
      lines.push(`- **Summary**: ${state.best.summary}`);
    }
    lines.push("");
  }

  const recentTrials = state.results.filter((r) => r.kind === "trial").slice(-5);
  if (recentTrials.length > 0) {
    lines.push(`## Recent Trials (last ${recentTrials.length})`);
    for (const trial of recentTrials) {
      const status =
        trial.status === "kept" ? "KEPT" : trial.status === "failed" ? "FAILED" : "DISCARDED";
      const value = trial.value !== undefined ? `${trial.value} ${session.unit}` : "N/A";
      lines.push(`- [${status}] iter ${trial.iteration}: ${value} — ${trial.summary}`);
    }
    lines.push("");
  }

  const deadEnds = state.results
    .filter((r) => r.kind === "trial" && (r.status === "discarded" || r.status === "failed"))
    .slice(-10);
  if (deadEnds.length > 0) {
    lines.push(`## Dead Ends — Do NOT Retry These Approaches`);
    for (const de of deadEnds) {
      lines.push(`- iter ${de.iteration}: ${de.summary}`);
      if (de.diff !== undefined) {
        lines.push(`  Diff summary: ${de.diff.slice(0, 200)}`);
      }
    }
    lines.push("");
  }

  if (steers.length > 0) {
    lines.push(`## User Guidance`);
    for (const steer of steers) {
      lines.push(`- ${steer.guidance}`);
    }
    lines.push("");
  }

  lines.push(`## Instructions`);
  lines.push(`You are working in: ${worktreePath}`);
  lines.push(`The original source is in: ${sourcePath} (read-only reference)`);
  lines.push(
    `Your goal: make changes to improve the result (${session.direction === "min" ? "lower is better" : "higher is better"}).`,
  );
  lines.push(`After making changes, the benchmark command will be run automatically.`);
  lines.push(`Be surgical — make one focused change per iteration.`);
  lines.push(`Do NOT modify the benchmark files.`);

  return lines.join("\n");
};

export const buildSetupPrompt = (
  sourcePath: string,
  worktreePath: string,
  benchmarkCmd: string,
): string => {
  const lines: Array<string> = [];

  lines.push(`# Workspace Setup Discovery`);
  lines.push("");
  lines.push(`You are setting up a worktree for an autonomous optimization experiment.`);
  lines.push("");
  lines.push(`## Source project: ${sourcePath}`);
  lines.push(`## Worktree: ${worktreePath}`);
  lines.push(`## Benchmark command: ${benchmarkCmd}`);
  lines.push("");
  lines.push(`Analyze the source project and determine what setup is needed in the worktree.`);
  lines.push(`Output a JSON file at ${worktreePath}/.xp/setup.json with this shape:`);
  lines.push("```json");
  lines.push(`{`);
  lines.push(`  "files": [{ "source": "<abs path>", "destination": "<abs path in worktree>" }],`);
  lines.push(
    `  "symlinks": [{ "source": "<abs path>", "destination": "<abs path in worktree>" }],`,
  );
  lines.push(`  "commands": ["<shell command to run in worktree>"]`);
  lines.push(`}`);
  lines.push("```");
  lines.push("");
  lines.push(`Common needs: symlink node_modules, copy config files, install dependencies.`);
  lines.push(`Only include what's necessary to make the benchmark command succeed.`);

  return lines.join("\n");
};

export const formatResultForLog = (result: ResultEvent, session: Session): string => {
  const status =
    result.status === "kept" ? "KEPT" : result.status === "failed" ? "FAILED" : "DISCARDED";
  const value = result.value !== undefined ? `${result.value} ${session.unit}` : "N/A";
  return `[${status}] iter ${result.iteration} (${result.kind}): ${value} — ${result.summary}`;
};
