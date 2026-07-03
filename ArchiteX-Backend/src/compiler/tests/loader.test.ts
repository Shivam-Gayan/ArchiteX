import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RuleLoader } from "../loader/RuleLoader";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

describe("RuleLoader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "archql-tests-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("loads and parses a valid .arch file", async () => {
    const file1 = path.join(tempDir, "test1.arch");
    await fs.writeFile(
      file1,
      `
      RULE "Rule 1"
      SEVERITY ERROR
      MATCH (a:Server)
      YIELD "msg" WITH a
      `
    );

    const loader = new RuleLoader();
    const result = await loader.load([file1]);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].name).toBe("Rule 1");
    // Verify sourceFile was stamped
    expect(result.rules[0].sourceFile).toBe("test1.arch");
    expect(result.summary.filesLoaded).toBe(1);
    expect(result.summary.rulesLoaded).toBe(1);
    expect(result.summary.errorCount).toBe(0);
  });

  it("loads multiple files and catches cross-file duplicate rule names (S007)", async () => {
    const file1 = path.join(tempDir, "dup1.arch");
    const file2 = path.join(tempDir, "dup2.arch");
    await fs.writeFile(
      file1,
      `
      RULE "Same Name"
      SEVERITY ERROR
      MATCH (a:Server)
      YIELD "msg" WITH a
      `
    );
    await fs.writeFile(
      file2,
      `
      RULE "Same Name"
      SEVERITY WARNING
      MATCH (b:Database)
      YIELD "msg" WITH b
      `
    );

    const loader = new RuleLoader();
    const result = await loader.load([file1, file2]);

    expect(result.rules).toHaveLength(1); // Only the first one is valid
    expect(result.rules[0].severity).toBe("ERROR");
    expect(result.rules[0].sourceFile).toBe("dup1.arch");

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].phase).toBe("semantic");
    expect(result.diagnostics[0].code).toBe("S007"); // Duplicate name
    // The diagnostic should point to the file that caused the conflict (dup1.arch because the duplicate is found when processing the batch, and we map it back to the origin rule)
    expect(result.diagnostics[0].sourceFile).toBe("dup1.arch");
    expect(result.summary.errorCount).toBe(1);
  });

  it("handles missing files gracefully", async () => {
    const loader = new RuleLoader();
    const result = await loader.load([path.join(tempDir, "does-not-exist.arch")]);

    expect(result.rules).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].phase).toBe("lex");
    expect(result.diagnostics[0].code).toBe("L000");
    expect(result.diagnostics[0].message).toContain("Cannot read file");
    expect(result.summary.errorCount).toBe(1);
  });

  it("collects lex, parse, and semantic errors in one pass", async () => {
    const file1 = path.join(tempDir, "bad.arch");
    await fs.writeFile(
      file1,
      `
      RULE "Parse Error Rule"
      SEVERITY OOPS # Parse error: invalid severity
      MATCH (a:Server)
      YIELD "msg" WITH a

      RULE "Semantic Error Rule"
      SEVERITY ERROR
      MATCH (b:Server)
      WHERE ghost = true # Semantic error: unbound var (S001)
      YIELD "msg" WITH b
      `
    );

    const loader = new RuleLoader();
    const result = await loader.load([file1]);

    expect(result.rules).toHaveLength(0);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    
    const hasParseError = result.diagnostics.some(d => d.phase === "parse" && d.message.includes("severity level"));
    const hasSemanticError = result.diagnostics.some(d => d.phase === "semantic" && d.code === "S001");
    
    expect(hasParseError).toBe(true);
    expect(hasSemanticError).toBe(true);
  });

  it("loadDirectory loads all .arch files in a folder", async () => {
    await fs.writeFile(path.join(tempDir, "dir1.arch"), 'RULE "R1" SEVERITY INFO MATCH (a:Server) YIELD "m" WITH a');
    await fs.writeFile(path.join(tempDir, "dir2.arch"), 'RULE "R2" SEVERITY INFO MATCH (b:Server) YIELD "m" WITH b');
    await fs.writeFile(path.join(tempDir, "ignored.txt"), 'not an arch file');

    const loader = new RuleLoader();
    const result = await loader.loadDirectory(tempDir);

    expect(result.diagnostics).toHaveLength(0);
    expect(result.rules).toHaveLength(2);
    const names = result.rules.map(r => r.name).sort();
    expect(names).toEqual(["R1", "R2"]);
    expect(result.summary.filesLoaded).toBe(2);
  });
});
