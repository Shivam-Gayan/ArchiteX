import path from "path";
import { createApp } from "./server";
import { ArchQLEngine } from "./engine/ArchQLEngine";

const PORT = 4000;

// Rule files shipped with the backend — relative to the project root
const RULES_DIR = path.join(__dirname, "..", "rules");
const RULE_FILES = [
  path.join(RULES_DIR, "availability_rules.arch"),
  path.join(RULES_DIR, "performance_rules.arch"),
  path.join(RULES_DIR, "security_rules.arch"),
];

async function bootstrap() {
  const engine = new ArchQLEngine();

  // Load and compile all .arch rule files at startup.
  // The engine logs warnings for any files with diagnostics but does not throw.
  await engine.loadRules(RULE_FILES);

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