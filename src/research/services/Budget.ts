import { Clock, Effect, Layer, Context } from "effect";
import type { ExperimentState, Session } from "../types.js";

export interface BudgetCheck {
  readonly canContinue: boolean;
  readonly reason?: string;
}

export class BudgetService extends Context.Service<
  BudgetService,
  {
    readonly check: (session: Session, state: ExperimentState) => Effect.Effect<BudgetCheck>;
  }
>()("@cvr/okra/research/services/Budget/BudgetService") {
  static layer: Layer.Layer<BudgetService> = Layer.succeed(BudgetService, {
    check: (session, state) =>
      Effect.gen(function* () {
        // Max iterations
        if (state.iteration >= session.maxIterations) {
          return {
            canContinue: false,
            reason: `Max iterations reached (${session.maxIterations})`,
          };
        }

        // Max consecutive failures
        const recentResults = state.results.filter((r) => r.kind === "trial");
        let consecutiveFailures = 0;
        for (let i = recentResults.length - 1; i >= 0; i--) {
          if (recentResults[i]?.status === "failed") {
            consecutiveFailures++;
          } else {
            break;
          }
        }
        if (consecutiveFailures >= session.maxFailures) {
          return {
            canContinue: false,
            reason: `Max consecutive failures reached (${session.maxFailures})`,
          };
        }

        // Deadline
        if (session.deadline !== undefined) {
          const nowMs = yield* Clock.currentTimeMillis;
          const deadlineMs = Date.parse(session.deadline);
          if (nowMs >= deadlineMs) {
            return {
              canContinue: false,
              reason: `Deadline reached (${session.deadline})`,
            };
          }
        }

        return { canContinue: true };
      }),
  });
}
