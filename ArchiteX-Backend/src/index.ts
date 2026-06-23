import { createApp } from "./server";
import { MockRuleEngine } from "./engine/services/MockRuleEngine";

const PORT = 4000;

async function bootstrap() {
  // TODO: Replace MockRuleEngine with real ArchQLEngine once Dev C integrates it.
  // The swap is a one-liner here — everything else stays the same.
  const engine = new MockRuleEngine();

  // Load rules at startup
  // TODO: Pass real .arch file paths from config once they exist
  await engine.loadRules([]);

  const app = createApp(engine);

  app.listen(PORT, () => {
    console.log(`[ArchiteX] Server running on http://localhost:${PORT}/api/v1`);
    console.log(`[ArchiteX] Engine ready: ${engine.isReady()}, rules loaded: ${engine.getLoadedRules().length}`);
  });
}

bootstrap().catch((err) => {
  console.error("[ArchiteX] Fatal startup error:", err);
  process.exit(1);
});