import { describe, it, expect } from "vitest";
import { ArchitectureGraph } from "../../graph/models/ArchitectureGraph";
import type { GraphNode } from "../../graph/models/GraphNode";
import type { GraphEdge } from "../../graph/models/GraphEdge";
import { Lexer } from "../../compiler/lexer/lexer";
import { Parser } from "../../compiler/parser/Parser";
import { SemanticAnalyser } from "../../compiler/semantic/SemanticAnalyser";
import { Matcher } from "../Matcher";
import { Evaluator } from "../Evaluator";
import { ArchQLEngine } from "../ArchQLEngine";
import type { RuleNode } from "../../compiler/ast/RuleAST";

/**
 * Graph Engine integration tests.
 *
 * Each test builds a concrete ArchitectureGraph, compiles an ArchQL rule
 * inline, and asserts the correct violations are (or are not) produced.
 *
 * These are end-to-end tests for the Compiler→Engine pipeline,
 * not mock-based unit tests.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildGraph(nodes: GraphNode[], edges: GraphEdge[]): ArchitectureGraph {
  return new ArchitectureGraph(nodes, edges);
}

function compileRule(source: string): RuleNode {
  const { tokens, diagnostics: lexDiags } = new Lexer(source).tokenize();
  expect(lexDiags).toHaveLength(0);
  const { rules, diagnostics: parseDiags } = new Parser(tokens).parse();
  expect(parseDiags).toHaveLength(0);
  const { validRules, diagnostics: semDiags } = new SemanticAnalyser().analyse(rules);
  expect(semDiags).toHaveLength(0);
  expect(validRules).toHaveLength(1);
  return { ...validRules[0], sourceFile: "test.arch" };
}

function node(id: string, type: string, props: Record<string, string | number | boolean> = {}): GraphNode {
  return { id, type, label: type, properties: props };
}

function edge(id: string, sourceId: string, targetId: string, type = "Traffic", props: Record<string, string | number | boolean> = {}): GraphEdge {
  return { id, sourceId, targetId, type, properties: props };
}

// ---------------------------------------------------------------------------
// Matcher unit tests
// ---------------------------------------------------------------------------

describe("Matcher", () => {
  const matcher = new Matcher();

  it("matches a simple (a:Client) -> (b:Database) pattern", () => {
    const g = buildGraph(
      [node("c1", "Client"), node("db1", "Database")],
      [edge("e1", "c1", "db1")]
    );
    const rule = compileRule(`
      RULE "Direct DB"
      SEVERITY ERROR
      MATCH (c:Client) -> (db:Database)
      YIELD "Direct access" WITH c, db
    `);
    const bindings = matcher.match(rule.matchClause, g);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].get("c")).toMatchObject({ id: "c1" });
    expect(bindings[0].get("db")).toMatchObject({ id: "db1" });
  });

  it("returns no bindings when there is no matching edge", () => {
    const g = buildGraph(
      [node("c1", "Client"), node("s1", "Server")],
      [edge("e1", "c1", "s1")]
    );
    const rule = compileRule(`
      RULE "Direct DB"
      SEVERITY ERROR
      MATCH (c:Client) -> (db:Database)
      YIELD "Direct access" WITH c, db
    `);
    const bindings = matcher.match(rule.matchClause, g);
    expect(bindings).toHaveLength(0);
  });

  it("matches a node with an inline property filter", () => {
    const g = buildGraph(
      [node("db1", "Database", { public: true }), node("db2", "Database", { public: false })],
      []
    );
    const rule = compileRule(`
      RULE "Public DB"
      SEVERITY ERROR
      MATCH (db:Database {public:true})
      YIELD "Public" WITH db
    `);
    const bindings = matcher.match(rule.matchClause, g);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].get("db")).toMatchObject({ id: "db1" });
  });

  it("matches an edge with an inline property filter", () => {
    const g = buildGraph(
      [node("s1", "Server"), node("db1", "Database")],
      [
        edge("e1", "s1", "db1", "Writes", { encrypted: false }),
        edge("e2", "s1", "db1", "Writes", { encrypted: true }),
      ]
    );
    const rule = compileRule(`
      RULE "Unencrypted"
      SEVERITY ERROR
      MATCH (s:Server) -[conn:Writes {encrypted:false}]-> (db:Database)
      YIELD "Unencrypted" WITH s, db
    `);
    const bindings = matcher.match(rule.matchClause, g);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].get("conn")).toMatchObject({ id: "e1" });
  });

  it("matches multiple bindings when multiple paths exist", () => {
    const g = buildGraph(
      [node("lb", "LoadBalancer"), node("s1", "Server"), node("s2", "Server")],
      [edge("e1", "lb", "s1"), edge("e2", "lb", "s2")]
    );
    const rule = compileRule(`
      RULE "SPOF"
      SEVERITY ERROR
      MATCH (lb:LoadBalancer) -> (srv:Server)
      WHERE COUNT(srv) BY lb < 2
      YIELD "SPOF" WITH lb, srv
    `);
    const bindings = matcher.match(rule.matchClause, g);
    expect(bindings).toHaveLength(2);
  });

  it("matches a multi-hop path (*1..3)", () => {
    const g = buildGraph(
      [node("c", "Client"), node("s", "Server"), node("db", "Database")],
      [edge("e1", "c", "s", "Calls"), edge("e2", "s", "db", "Calls")]
    );
    const rule = compileRule(`
      RULE "Deep chain"
      SEVERITY ERROR
      MATCH (c:Client) -[:Calls*1..3]-> (db:Database)
      YIELD "Deep" WITH c, db
    `);
    const bindings = matcher.match(rule.matchClause, g);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].get("db")).toMatchObject({ id: "db" });
  });
});

// ---------------------------------------------------------------------------
// Evaluator unit tests
// ---------------------------------------------------------------------------

describe("Evaluator", () => {
  const matcher   = new Matcher();
  const evaluator = new Evaluator();

  it("emits a violation when WHERE passes (simple property comparison)", () => {
    const g = buildGraph([node("s1", "Server", { cpu: 90 })], []);
    const rule = compileRule(`
      RULE "High CPU"
      SEVERITY WARNING
      MATCH (srv:Server)
      SIMULATE maxCPU = 85
      WHERE srv.cpu > maxCPU
      YIELD "CPU too high" WITH srv
    `);
    const bindings = matcher.match(rule.matchClause, g);
    const violations = evaluator.evaluate(rule, bindings, g, null);
    expect(violations).toHaveLength(1);
    expect(violations[0].ruleName).toBe("High CPU");
    expect(violations[0].highlightedNodeIds).toEqual(["s1"]);
  });

  it("does not emit when WHERE fails", () => {
    const g = buildGraph([node("s1", "Server", { cpu: 70 })], []);
    const rule = compileRule(`
      RULE "High CPU"
      SEVERITY WARNING
      MATCH (srv:Server)
      SIMULATE maxCPU = 85
      WHERE srv.cpu > maxCPU
      YIELD "CPU too high" WITH srv
    `);
    const bindings = matcher.match(rule.matchClause, g);
    const violations = evaluator.evaluate(rule, bindings, g, null);
    expect(violations).toHaveLength(0);
  });

  it("simulation override takes priority over rule default", () => {
    const g = buildGraph([node("s1", "Server", { cpu: 70 })], []);
    const rule = compileRule(`
      RULE "High CPU"
      SEVERITY WARNING
      MATCH (srv:Server)
      SIMULATE maxCPU = 85
      WHERE srv.cpu > maxCPU
      YIELD "CPU too high" WITH srv
    `);
    const bindings = matcher.match(rule.matchClause, g);
    // Override maxCPU to 60 — now cpu=70 > maxCPU=60, should fire
    const violations = evaluator.evaluate(rule, bindings, g, { maxCPU: 60 });
    expect(violations).toHaveLength(1);
  });

  it("evaluates NOT EXISTS(optionalVar) correctly — OPTIONAL not matched = violation", () => {
    const g = buildGraph(
      [node("api", "APIGateway")],
      []
    );
    const rule = compileRule(`
      RULE "No Auth"
      SEVERITY ERROR
      MATCH (api:APIGateway)
      OPTIONAL (api) -> (auth:AuthService)
      WHERE NOT EXISTS(auth)
      YIELD "No auth service" WITH api
    `);
    const matchBindings = matcher.match(rule.matchClause, g);
    // Extend with OPTIONAL (no auth service present)
    const allBindings = matchBindings.map((env) => {
      const ext = new Map(env);
      ext.set("auth", null); // OPTIONAL did not match
      return ext;
    });
    const violations = evaluator.evaluate(rule, allBindings, g, null);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toBe("No auth service");
  });

  it("evaluates NOT EXISTS(optionalVar) correctly — OPTIONAL matched = no violation", () => {
    const g = buildGraph(
      [node("api", "APIGateway"), node("auth", "AuthService")],
      [edge("e1", "api", "auth")]
    );
    const rule = compileRule(`
      RULE "No Auth"
      SEVERITY ERROR
      MATCH (api:APIGateway)
      OPTIONAL (api) -> (auth:AuthService)
      WHERE NOT EXISTS(auth)
      YIELD "No auth service" WITH api
    `);
    const matchBindings = matcher.match(rule.matchClause, g);
    const optBindings   = matcher.match(rule.optionalClauses[0], g, matchBindings[0]);
    const violations = evaluator.evaluate(rule, optBindings, g, null);
    expect(violations).toHaveLength(0);
  });

  it("evaluates COUNT BY correctly — SPOF rule", () => {
    const g = buildGraph(
      [node("lb", "LoadBalancer"), node("s1", "Server")],
      [edge("e1", "lb", "s1")]
    );
    const rule = compileRule(`
      RULE "SPOF"
      SEVERITY ERROR
      MATCH (lb:LoadBalancer) -> (srv:Server)
      WHERE COUNT(srv) BY lb < 2
      YIELD "Single point of failure" WITH lb, srv
    `);
    const bindings = matcher.match(rule.matchClause, g);
    const violations = evaluator.evaluate(rule, bindings, g, null);
    expect(violations).toHaveLength(1);
  });

  it("no violation when COUNT BY passes (2+ servers)", () => {
    const g = buildGraph(
      [node("lb", "LoadBalancer"), node("s1", "Server"), node("s2", "Server")],
      [edge("e1", "lb", "s1"), edge("e2", "lb", "s2")]
    );
    const rule = compileRule(`
      RULE "SPOF"
      SEVERITY ERROR
      MATCH (lb:LoadBalancer) -> (srv:Server)
      WHERE COUNT(srv) BY lb < 2
      YIELD "Single point of failure" WITH lb, srv
    `);
    const bindings = matcher.match(rule.matchClause, g);
    const violations = evaluator.evaluate(rule, bindings, g, null);
    expect(violations).toHaveLength(0);
  });

  it("evaluates DEGREE function correctly", () => {
    const g = buildGraph(
      [node("s1", "Server"), node("a", "Server"), node("b", "Server"),
       node("c", "Server"), node("d", "Server"), node("e", "Server"),
       node("f", "Server"), node("gn", "Server"), node("h", "Server"), node("i", "Server")],
      // 9 outgoing edges from s1 → DEGREE(s1) = 9 > 8
      ["a","b","c","d","e","f","gn","h","i"].map((t, i) => edge(`e${i}`, "s1", t))
    );
    const rule = compileRule(`
      RULE "God Service"
      SEVERITY WARNING
      MATCH (srv:Server)
      WHERE DEGREE(srv) > 8
      YIELD "God service" WITH srv
    `);
    const bindings = matcher.match(rule.matchClause, g);
    const violations = evaluator.evaluate(rule, bindings, g, null);
    expect(violations.some(v => v.highlightedNodeIds.includes("s1"))).toBe(true);
  });

  it("evaluates EXISTS path form correctly", () => {
    const g = buildGraph(
      [node("s1", "Server"), node("db1", "Database")],
      [edge("e1", "s1", "db1")]
    );
    const rule = compileRule(`
      RULE "No Cache"
      SEVERITY WARNING
      MATCH (srv:Server) -> (db:Database)
      WHERE NOT EXISTS((srv) -[:Reads*1..2]-> (:Cache))
      YIELD "No cache" WITH srv, db
    `);
    const bindings = matcher.match(rule.matchClause, g);
    const violations = evaluator.evaluate(rule, bindings, g, null);
    expect(violations).toHaveLength(1); // No cache connected
  });

  it("YIELD ONCE — emits exactly one violation even for multiple matching bindings", () => {
    const g = buildGraph(
      [node("s1", "Server"), node("s2", "Server")],
      []
    );
    const rule = compileRule(`
      RULE "Global Warning"
      SEVERITY INFO
      MATCH (srv:Server)
      YIELD "Observation" ONCE
    `);
    const bindings = matcher.match(rule.matchClause, g);
    const violations = evaluator.evaluate(rule, bindings, g, null);
    expect(violations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ArchQLEngine end-to-end integration
// ---------------------------------------------------------------------------

describe("ArchQLEngine — end-to-end", () => {
  it("detects direct client-to-database access", async () => {
    const engine = new ArchQLEngine();
    // Load inline via the file system using the real .arch files
    const path = await import("path");
    const rulesDir = path.join(process.cwd(), "rules");
    await engine.loadRules([path.join(rulesDir, "security_rules.arch")]);
    expect(engine.isReady()).toBe(true);
    expect(engine.getLoadedRules().length).toBeGreaterThan(0);

    const g = buildGraph(
      [node("c1", "Client"), node("db1", "Database")],
      [edge("e1", "c1", "db1")]
    );
    const violations = engine.evaluate(g, { simulationOverrides: null, categories: null, excludeRules: null });
    expect(violations.some(v => v.ruleName === "Client Directly Accesses Database")).toBe(true);
  });

  it("detects SPOF — single server behind load balancer", async () => {
    const engine = new ArchQLEngine();
    const path = await import("path");
    await engine.loadRules([path.join(process.cwd(), "rules", "availability_rules.arch")]);

    const g = buildGraph(
      [node("lb1", "LoadBalancer"), node("s1", "Server")],
      [edge("e1", "lb1", "s1")]
    );
    const violations = engine.evaluate(g, { simulationOverrides: null, categories: null, excludeRules: null });
    expect(violations.some(v => v.ruleName === "Single Server Behind Load Balancer")).toBe(true);
    expect(violations[0].highlightedNodeIds).toContain("lb1");
    expect(violations[0].highlightedNodeIds).toContain("s1");
  });

  it("no SPOF violation when 2+ servers behind LB", async () => {
    const engine = new ArchQLEngine();
    const path = await import("path");
    await engine.loadRules([path.join(process.cwd(), "rules", "availability_rules.arch")]);

    const g = buildGraph(
      [node("lb1", "LoadBalancer"), node("s1", "Server"), node("s2", "Server")],
      [edge("e1", "lb1", "s1"), edge("e2", "lb1", "s2")]
    );
    const violations = engine.evaluate(g, { simulationOverrides: null, categories: null, excludeRules: null });
    expect(violations.some(v => v.ruleName === "Single Server Behind Load Balancer")).toBe(false);
  });

  it("detects unencrypted database connection", async () => {
    const engine = new ArchQLEngine();
    const path = await import("path");
    await engine.loadRules([path.join(process.cwd(), "rules", "security_rules.arch")]);

    const g = buildGraph(
      [node("s1", "Server"), node("db1", "Database")],
      [edge("e1", "s1", "db1", "Writes", { encrypted: false })]
    );
    const violations = engine.evaluate(g, { simulationOverrides: null, categories: null, excludeRules: null });
    expect(violations.some(v => v.ruleName === "Unencrypted Database Connection")).toBe(true);
  });

  it("no violation for encrypted database connection", async () => {
    const engine = new ArchQLEngine();
    const path = await import("path");
    await engine.loadRules([path.join(process.cwd(), "rules", "security_rules.arch")]);

    const g = buildGraph(
      [node("s1", "Server"), node("db1", "Database")],
      [edge("e1", "s1", "db1", "Writes", { encrypted: true })]
    );
    const violations = engine.evaluate(g, { simulationOverrides: null, categories: null, excludeRules: null });
    expect(violations.some(v => v.ruleName === "Unencrypted Database Connection")).toBe(false);
  });

  it("simulation override changes which servers fail CPU threshold", async () => {
    const engine = new ArchQLEngine();
    const path = await import("path");
    await engine.loadRules([path.join(process.cwd(), "rules", "performance_rules.arch")]);

    const g = buildGraph([node("s1", "Server", { cpu: 70 })], []);

    // Default threshold = 85 → cpu=70 is fine
    const v1 = engine.evaluate(g, { simulationOverrides: null, categories: null, excludeRules: null });
    expect(v1.some(v => v.ruleName === "Server CPU Exceeds Threshold")).toBe(false);

    // Override threshold to 60 → cpu=70 > 60, should fire
    const v2 = engine.evaluate(g, { simulationOverrides: { maxCPU: 60 }, categories: null, excludeRules: null });
    expect(v2.some(v => v.ruleName === "Server CPU Exceeds Threshold")).toBe(true);
  });

  it("ruleFilter.categories filters to only those categories", async () => {
    const engine = new ArchQLEngine();
    const path = await import("path");
    await engine.loadRules([
      path.join(process.cwd(), "rules", "availability_rules.arch"),
      path.join(process.cwd(), "rules", "security_rules.arch"),
    ]);

    const g = buildGraph(
      [node("c1", "Client"), node("db1", "Database"), node("lb1", "LoadBalancer"), node("s1", "Server")],
      [edge("e1", "c1", "db1"), edge("e2", "lb1", "s1")]
    );

    // Only run availability rules — direct DB access is a security rule
    const violations = engine.evaluate(g, { simulationOverrides: null, categories: ["availability"], excludeRules: null });
    expect(violations.some(v => v.ruleName === "Client Directly Accesses Database")).toBe(false);
    expect(violations.some(v => v.ruleName === "Single Server Behind Load Balancer")).toBe(true);
  });

  it("ruleFilter.excludeRules skips named rules", async () => {
    const engine = new ArchQLEngine();
    const path = await import("path");
    await engine.loadRules([path.join(process.cwd(), "rules", "availability_rules.arch")]);

    const g = buildGraph(
      [node("lb1", "LoadBalancer"), node("s1", "Server")],
      [edge("e1", "lb1", "s1")]
    );
    const violations = engine.evaluate(g, {
      simulationOverrides: null,
      categories: null,
      excludeRules: ["Single Server Behind Load Balancer"],
    });
    // The SPOF rule was excluded — must not appear
    expect(violations.some(v => v.ruleName === "Single Server Behind Load Balancer")).toBe(false);
  });

  it("getLoadedRules returns correct metadata", async () => {
    const engine = new ArchQLEngine();
    const path = await import("path");
    await engine.loadRules([path.join(process.cwd(), "rules", "security_rules.arch")]);

    const rules = engine.getLoadedRules();
    expect(rules.length).toBeGreaterThan(0);
    const cpuRule = rules.find(r => r.name === "Server CPU Exceeds Threshold");
    // Not in security_rules.arch — should be absent
    expect(cpuRule).toBeUndefined();

    const dbRule = rules.find(r => r.name === "Unencrypted Database Connection");
    expect(dbRule).toBeDefined();
    expect(dbRule?.category).toBe("security");
    expect(dbRule?.severity).toBe("ERROR");
    expect(dbRule?.hasSimulation).toBe(false);
  });
});
