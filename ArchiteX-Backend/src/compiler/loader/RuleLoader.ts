/**
 * RuleLoader
 *
 * Reads .arch files from disk, runs them through the full compiler pipeline
 * (Lexer → Parser → SemanticAnalyser), and produces validated RuleNode[]
 * ready for the Matcher/Evaluator.
 *
 * Responsibilities:
 *  1. Read each .arch file from disk (UTF-8)
 *  2. Lex → Parse per file, collecting per-file diagnostics
 *  3. Stamp sourceFile on every parsed RuleNode
 *  4. Run SemanticAnalyser on ALL rules together (cross-file S007 duplicate check)
 *  5. Return {rules, diagnostics} — never throws on bad rules
 *
 * What this class does NOT do:
 *  - Directory watching / hot reload (future work)
 *  - Rule evaluation (Matcher/Evaluator's job)
 *  - HTTP or Express concerns
 */

import { readFile } from "fs/promises";
import path from "path";
import { Lexer } from "../lexer/lexer";
import { Parser } from "../parser/Parser";
import { SemanticAnalyser } from "../semantic/SemanticAnalyser";
import type { RuleNode } from "../ast/RuleAST";
import {
  ParseDiagnosticCode,
  type ParseDiagnostic,
} from "../diagnostics/parseDiagnostics";
import type { SemanticDiagnostic } from "../diagnostics/semanticDiagnostics";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface LoadFileDiagnostic {
  /** Absolute or relative path to the .arch file */
  readonly sourceFile: string;
  /** "lex", "parse", or "semantic" */
  readonly phase: "lex" | "parse" | "semantic";
  readonly code: string;
  readonly message: string;
  /** 1-based line (0 for file-level errors like "cannot read file") */
  readonly line: number;
  /** 1-based column */
  readonly column: number;
}

export interface LoadResult {
  /** All rules that passed the full pipeline — safe to evaluate */
  readonly rules: RuleNode[];
  /** Aggregated diagnostics from all files and all phases */
  readonly diagnostics: LoadFileDiagnostic[];
  /** Summary counts for logging / health endpoint */
  readonly summary: {
    readonly filesLoaded: number;
    readonly rulesLoaded: number;
    readonly errorCount: number;
    readonly warnCount: number;
  };
}

// ---------------------------------------------------------------------------
// RuleLoader
// ---------------------------------------------------------------------------

export class RuleLoader {
  private readonly analyser = new SemanticAnalyser();

  /**
   * Load and compile a list of .arch file paths.
   *
   * @param filePaths  Absolute or relative paths to .arch files.
   * @returns          LoadResult with all valid rules and any diagnostics.
   */
  async load(filePaths: string[]): Promise<LoadResult> {
    const allDiagnostics: LoadFileDiagnostic[] = [];
    const allParsedRules: RuleNode[] = [];

    for (const filePath of filePaths) {
      const normalised = path.normalize(filePath);
      const fileName = path.basename(normalised);

      // --- Step 1: Read file ---
      let source: string;
      try {
        source = await readFile(normalised, "utf-8");
      } catch (err) {
        allDiagnostics.push({
          sourceFile: normalised,
          phase: "lex",
          code: "L000",
          message: `Cannot read file '${normalised}': ${(err as Error).message}`,
          line: 0,
          column: 0,
        });
        continue;
      }

      // --- Step 2: Lex ---
      const { tokens, diagnostics: lexDiags } = new Lexer(source).tokenize();
      for (const d of lexDiags) {
        allDiagnostics.push({
          sourceFile: normalised,
          phase: "lex",
          code: d.code,
          message: d.message,
          line: d.line,
          column: d.column,
        });
      }

      // --- Step 3: Parse ---
      const { rules: parsedRules, diagnostics: parseDiags } =
        new Parser(tokens).parse();
      for (const d of parseDiags) {
        allDiagnostics.push({
          sourceFile: normalised,
          phase: "parse",
          code: d.code,
          message: d.message,
          line: d.line,
          column: d.column,
        });
      }

      // --- Step 4: Stamp sourceFile on every parsed rule ---
      const stamped = parsedRules.map(
        (rule): RuleNode => ({ ...rule, sourceFile: fileName })
      );

      allParsedRules.push(...stamped);
    }

    // --- Step 5: Semantic analysis across ALL files in one batch ---
    // This is where cross-file S007 (duplicate rule names) is caught.
    const { validRules, diagnostics: semDiags } =
      this.analyser.analyse(allParsedRules);

    // Map SemanticDiagnostic → LoadFileDiagnostic
    for (const d of semDiags) {
      // Find which file the failing rule came from
      const originRule = allParsedRules.find((r) => r.name === d.ruleName);
      allDiagnostics.push({
        sourceFile: originRule?.sourceFile ?? "<unknown>",
        phase: "semantic",
        code: d.code,
        message: d.message,
        line: d.line,
        column: d.column,
      });
    }

    const errorCount = allDiagnostics.filter(
      (d) => d.phase !== "semantic" || true
    ).length;

    return {
      rules: validRules,
      diagnostics: allDiagnostics,
      summary: {
        filesLoaded: filePaths.length,
        rulesLoaded: validRules.length,
        errorCount: allDiagnostics.length,
        warnCount: 0, // future: distinguish warnings from errors
      },
    };
  }

  /**
   * Convenience method: loads all .arch files from a directory (non-recursive).
   *
   * @param dirPath   Directory to scan for *.arch files.
   */
  async loadDirectory(dirPath: string): Promise<LoadResult> {
    const { readdir } = await import("fs/promises");
    const normalised = path.normalize(dirPath);

    let entries: string[];
    try {
      entries = await readdir(normalised);
    } catch (err) {
      return {
        rules: [],
        diagnostics: [
          {
            sourceFile: normalised,
            phase: "lex",
            code: "L000",
            message: `Cannot read directory '${normalised}': ${(err as Error).message}`,
            line: 0,
            column: 0,
          },
        ],
        summary: { filesLoaded: 0, rulesLoaded: 0, errorCount: 1, warnCount: 0 },
      };
    }

    const archFiles = entries
      .filter((f) => f.endsWith(".arch"))
      .map((f) => path.join(normalised, f));

    return this.load(archFiles);
  }
}
