import express from "express";
import cors from "cors";
import type { RuleEngine } from "./engine/contracts/RuleEngine";
import { createApiRouter } from "./api/routes/api.routes";
import { jsonParseErrorHandler, globalErrorHandler } from "./api/middleware/errorHandler";

/**
 * Creates and configures the Express application.
 *
 * Receives a RuleEngine instance so the server is fully testable
 * with any implementation (MockRuleEngine or real ArchQLEngine).
 */
export function createApp(engine: RuleEngine) {
  const app = express();

  // Parse JSON bodies. SyntaxError from malformed JSON is caught below.
  app.use(express.json());
  app.use(cors());

  // All API routes under /api/v1 — ApiContract.md §1: "Base URL: /api/v1"
  app.use("/api/v1", createApiRouter(engine));

  // Error handlers MUST come after routes
  app.use(jsonParseErrorHandler);
  app.use(globalErrorHandler);

  return app;
}
