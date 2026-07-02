import { Router } from "express";
import type { RuleEngine } from "../../engine/contracts/RuleEngine";
import { ValidateController } from "../controllers/ValidateController";
import { NodeTypesController } from "../controllers/NodeTypesController";
import { EdgeTypesController } from "../controllers/EdgeTypesController";
import { RulesController } from "../controllers/RulesController";
import { HealthController } from "../controllers/HealthController";

/**
 * Builds and returns the Express router for all API v1 endpoints.
 * ApiContract.md §4–8.
 *
 * All routes are under /api/v1 (mounted in server.ts).
 * Controllers are injected — no direct construction here.
 */
export function createApiRouter(engine: RuleEngine): Router {
  const router = Router();

  const validate     = new ValidateController(engine);
  const nodeTypes    = new NodeTypesController();
  const edgeTypes    = new EdgeTypesController();
  const rules        = new RulesController(engine);
  const health       = new HealthController(engine);

  router.post("/validate",    validate.handle);
  router.get("/node-types",   nodeTypes.handle);
  router.get("/edge-types",   edgeTypes.handle);
  router.get("/rules",        rules.handle);
  router.get("/health",       health.handle);

  return router;
}
