import type { Request, Response } from "express";
import type { RuleEngine } from "../../engine/contracts/RuleEngine";
import type { HealthResponseDto } from "../dto/rules.dto";

/**
 * GET /api/v1/health — ApiContract.md §8
 *
 * Returns engine readiness status.
 * If the engine is not ready, returns 503 per spec.
 * Used by the frontend to show loading states and by load balancer health checks.
 */
export class HealthController {
  private readonly startTime = Date.now();

  constructor(private readonly engine: RuleEngine) {}

  handle = (_req: Request, res: Response): void => {
    const engineReady = this.engine.isReady();
    const rulesLoaded = engineReady ? this.engine.getLoadedRules().length : 0;
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    const response: HealthResponseDto = {
      status: engineReady ? "ok" : "unavailable",
      engineReady,
      rulesLoaded,
      uptime,
    };

    // ApiContract §8: 503 if engine not ready
    res.status(engineReady ? 200 : 503).json(response);
  };
}
