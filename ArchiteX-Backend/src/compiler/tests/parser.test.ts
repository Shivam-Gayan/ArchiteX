import { describe, it, expect } from "vitest";
import { Lexer } from "../lexer/lexer";
import { Parser } from "../parser/Parser";
import type { RuleNode, ComparisonExpr, NotExpr, AndExpr, FunctionCallNode, ExistsExprNode } from "../ast/RuleAST";

/**
 * Parser integration tests.
 *
 * Each test tokenises a .arch source string with the Lexer, then parses it
 * with the Parser, and asserts the resulting RuleNode structure matches the
 * ArchQL_v3_2.md spec examples exactly.
 *
 * Covers spec sections: §5, §9, §10, §11, §13, §14, §16, §18, §19.
 */

function parse(source: string): { rules: RuleNode[]; errors: string[] } {
  const { tokens, diagnostics: lexDiags } = new Lexer(source).tokenize();
  const { rules, diagnostics: parseDiags } = new Parser(tokens).parse();
  const errors = [
    ...lexDiags.map((d) => `[LEX] ${d.message}`),
    ...parseDiags.map((d) => `[PARSE] ${d.message}`),
  ];
  return { rules, errors };
}

// ---------------------------------------------------------------------------
// Happy path tests
// ---------------------------------------------------------------------------

describe("Parser — happy path", () => {

  it("parses a minimal rule with no optional clauses", () => {
    const src = `
      RULE "Direct Client-to-Database Access"
      SEVERITY ERROR

      MATCH (c:Client) -> (db:Database)

      YIELD "Client is directly connected to a database" WITH c, db
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);

    const rule = rules[0];
    expect(rule.name).toBe("Direct Client-to-Database Access");
    expect(rule.severity).toBe("ERROR");
    expect(rule.optionalClauses).toHaveLength(0);
    expect(rule.simulateBindings).toHaveLength(0);
    expect(rule.whereClause).toBeNull();

    // MATCH: (c:Client) -> (db:Database)
    const elems = rule.matchClause.elements;
    expect(elems).toHaveLength(3);
    expect(elems[0]).toMatchObject({ kind: "NodePattern", alias: "c", type: "Client" });
    expect(elems[1]).toMatchObject({ kind: "EdgePattern", direction: "directed", type: null });
    expect(elems[2]).toMatchObject({ kind: "NodePattern", alias: "db", type: "Database" });

    // YIELD
    expect(rule.yieldClause.message).toBe("Client is directly connected to a database");
    expect(rule.yieldClause.withVars).toEqual(["c", "db"]);
    expect(rule.yieldClause.once).toBe(false);
  });

  it("parses a rule with OPTIONAL and WHERE NOT EXISTS (variable form)", () => {
    // Spec §24 Rule 4 — API Gateway Without Authentication
    const src = `
      RULE "Unauthenticated API Gateway"
      SEVERITY ERROR

      MATCH (api:APIGateway)

      OPTIONAL (api) -> (auth:AuthService)

      WHERE NOT EXISTS(auth)

      YIELD "API Gateway has no authentication service" WITH api
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);
    const rule = rules[0];

    expect(rule.optionalClauses).toHaveLength(1);
    expect(rule.optionalClauses[0].elements[0]).toMatchObject({ kind: "NodePattern", alias: "api", type: null });

    // WHERE: NOT EXISTS(auth)
    const where = rule.whereClause as NotExpr;
    expect(where.kind).toBe("Not");
    const exists = where.operand as ExistsExprNode;
    expect(exists.kind).toBe("ExistsExpr");
    expect(exists.form).toBe("variable");
    expect(exists.variable).toBe("auth");
  });

  it("parses YIELD ONCE", () => {
    // Spec §24 Rule 8 — No Distributed Tracing
    const src = `
      RULE "No Distributed Tracing in Architecture"
      SEVERITY INFO

      MATCH (srv:Server)

      OPTIONAL (srv) -> (t:Tracing)

      WHERE NOT EXISTS(t)

      YIELD "No distributed tracing connected to any service" ONCE
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(rules[0].yieldClause.once).toBe(true);
    expect(rules[0].yieldClause.withVars).toEqual([]);
  });

  it("parses SIMULATE bindings", () => {
    // Spec §24 Rule 17 — Server CPU Exceeds Threshold
    const src = `
      RULE "Server CPU Exceeds Threshold"
      SEVERITY WARNING

      MATCH (srv:Server)

      SIMULATE maxCPU = 85

      WHERE srv.cpu > maxCPU

      YIELD "Server CPU exceeds acceptable threshold" WITH srv
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);
    const rule = rules[0];

    expect(rule.simulateBindings).toHaveLength(1);
    expect(rule.simulateBindings[0].variable).toBe("maxCPU");
    expect(rule.simulateBindings[0].value).toEqual({ kind: "number", value: 85 });

    // WHERE: srv.cpu > maxCPU
    const where = rule.whereClause as ComparisonExpr;
    expect(where.kind).toBe("Comparison");
    expect(where.operator).toBe(">");
    expect(where.left).toMatchObject({ kind: "PropertyAccess", variable: "srv", property: "cpu" });
    expect(where.right).toMatchObject({ kind: "Identifier", name: "maxCPU" });
  });

  it("parses COUNT BY aggregate in WHERE", () => {
    // Spec §24 Rule 1 — Single Point of Failure
    const src = `
      RULE "Single Server Behind Load Balancer"
      SEVERITY ERROR

      MATCH (lb:LoadBalancer) -> (srv:Server)

      WHERE COUNT(srv) BY lb < 2

      YIELD "Load balancer has fewer than 2 servers" WITH lb, srv
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);
    const rule = rules[0];

    const where = rule.whereClause as ComparisonExpr;
    expect(where.kind).toBe("Comparison");
    expect(where.operator).toBe("<");

    const fn = where.left as FunctionCallNode;
    expect(fn.kind).toBe("FunctionCall");
    expect(fn.name).toBe("COUNT");
    expect(fn.argument).toBe("srv");
    expect(fn.groupBy).toBe("lb");

    expect(where.right).toMatchObject({ kind: "Literal", value: { kind: "number", value: 2 } });
  });

  it("parses DEGREE function in WHERE", () => {
    // Spec §24 Rule 13 — God Service
    const src = `
      RULE "God Service Anti-Pattern"
      SEVERITY WARNING

      MATCH (srv:Server)

      WHERE DEGREE(srv) > 8

      YIELD "Service has too many outbound connections" WITH srv
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);

    const where = rules[0].whereClause as ComparisonExpr;
    expect(where.kind).toBe("Comparison");
    const fn = where.left as FunctionCallNode;
    expect(fn.name).toBe("DEGREE");
    expect(fn.argument).toBe("srv");
    expect(fn.groupBy).toBeNull();
  });

  it("parses edge with type and property filter", () => {
    // Spec §24 Rule 10 — Unencrypted Database Connection
    const src = `
      RULE "Unencrypted Database Connection"
      SEVERITY ERROR

      MATCH (srv:Server) -[conn:Writes {encrypted:false}]-> (db:Database)

      YIELD "Database write connection is not encrypted" WITH srv, db
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);

    const elems = rules[0].matchClause.elements;
    expect(elems).toHaveLength(3);
    const edge = elems[1];
    expect(edge.kind).toBe("EdgePattern");
    if (edge.kind === "EdgePattern") {
      expect(edge.alias).toBe("conn");
      expect(edge.type).toBe("Writes");
      expect(edge.properties.get("encrypted")).toEqual({ kind: "boolean", value: false });
    }
  });

  it("parses edge with path depth", () => {
    // Spec §24 Rule 14 — Deep Synchronous Call Chain
    const src = `
      RULE "Synchronous Call Chain Too Deep"
      SEVERITY WARNING

      MATCH (c:Client) -[:Calls*6..20]-> (db:Database)

      YIELD "Request reaches database through 6+ synchronous hops" WITH c, db
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);

    const elems = rules[0].matchClause.elements;
    const edge = elems[1];
    if (edge.kind === "EdgePattern") {
      expect(edge.type).toBe("Calls");
      expect(edge.depth).toEqual({ min: 6, max: 20 });
    }
  });

  it("parses EXISTS path form in WHERE", () => {
    // Spec §24 Rule 3 — Missing Cache Before Database
    const src = `
      RULE "No Cache Before Database"
      SEVERITY WARNING

      MATCH (srv:Server) -> (db:Database)

      WHERE NOT EXISTS((srv) -[:Reads*1..2]-> (:Cache))

      YIELD "Server reads database without a cache layer" WITH srv, db
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);

    const where = rules[0].whereClause as NotExpr;
    expect(where.kind).toBe("Not");
    const exists = where.operand as ExistsExprNode;
    expect(exists.form).toBe("path");
    expect(exists.path?.from).toMatchObject({ kind: "NodePattern", alias: "srv" });
    expect(exists.path?.edge?.type).toBe("Reads");
    expect(exists.path?.edge?.depth).toEqual({ min: 1, max: 2 });
    expect(exists.path?.to).toMatchObject({ kind: "NodePattern", alias: null, type: "Cache" });
  });

  it("parses AND compound WHERE clause", () => {
    // Spec §25 — Complete Rule Example
    const src = `
      RULE "Client Reads Directly From Public Database"
      SEVERITY ERROR

      MATCH (c:Client) -[:Reads]-> (db:Database)

      OPTIONAL (c) -> (gw:APIGateway)

      WHERE NOT EXISTS(gw)
        AND db.public = true

      YIELD "Client reads directly from a public database with no API gateway" WITH c, db
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);

    const where = rules[0].whereClause as AndExpr;
    expect(where.kind).toBe("And");

    const left = where.left as NotExpr;
    expect(left.kind).toBe("Not");

    const right = where.right as ComparisonExpr;
    expect(right.kind).toBe("Comparison");
    expect(right.operator).toBe("=");
    expect(right.left).toMatchObject({ kind: "PropertyAccess", variable: "db", property: "public" });
    expect(right.right).toMatchObject({ kind: "Literal", value: { kind: "boolean", value: true } });
  });

  it("parses node with inline property filter in MATCH", () => {
    // Spec §24 Rule 6 — Publicly Exposed Database
    const src = `
      RULE "Database Exposed to Internet"
      SEVERITY ERROR

      MATCH (db:Database {public:true})

      YIELD "Database is publicly accessible" WITH db
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);

    const node = rules[0].matchClause.elements[0];
    if (node.kind === "NodePattern") {
      expect(node.type).toBe("Database");
      expect(node.properties.get("public")).toEqual({ kind: "boolean", value: true });
    }
  });

  it("parses multiple rules in one file", () => {
    const src = `
      RULE "Rule A"
      SEVERITY ERROR
      MATCH (a:Server)
      YIELD "msg a" WITH a

      RULE "Rule B"
      SEVERITY WARNING
      MATCH (b:Database)
      YIELD "msg b" ONCE
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(2);
    expect(rules[0].name).toBe("Rule A");
    expect(rules[1].name).toBe("Rule B");
    expect(rules[1].yieldClause.once).toBe(true);
  });

  it("parses # comments and ignores them", () => {
    const src = `
      # This is a comment
      RULE "Commented Rule"
      SEVERITY INFO
      # Another comment
      MATCH (srv:Server)
      YIELD "test" WITH srv
    `;
    const { rules, errors } = parse(src);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Error recovery tests
// ---------------------------------------------------------------------------

describe("Parser — error recovery", () => {

  it("reports missing SEVERITY and still parses subsequent rule", () => {
    const src = `
      RULE "Bad Rule"
      MATCH (a:Server)
      YIELD "oops" WITH a

      RULE "Good Rule"
      SEVERITY WARNING
      MATCH (b:Database)
      YIELD "ok" WITH b
    `;
    const { rules, errors } = parse(src);
    // Parser should find the error and recover to parse "Good Rule"
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes("SEVERITY"))).toBe(true);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe("Good Rule");
  });

  it("reports invalid severity level", () => {
    const src = `
      RULE "Bad Severity"
      SEVERITY CRITICAL
      MATCH (a:Server)
      YIELD "oops" WITH a
    `;
    const { errors } = parse(src);
    expect(errors.some(e => e.includes("severity level"))).toBe(true);
  });

  it("reports == as invalid and continues", () => {
    // == is not valid ArchQL — spec uses = for equality
    const src = `
      RULE "Bad Operator"
      SEVERITY ERROR
      MATCH (a:Server)
      WHERE a.cpu == 90
      YIELD "bad" WITH a

      RULE "Good Rule"
      SEVERITY WARNING
      MATCH (b:Database)
      YIELD "ok" WITH b
    `;
    const { rules, errors } = parse(src);
    expect(errors.some(e => e.includes("==") || e.includes("not valid"))).toBe(true);
    expect(rules.some(r => r.name === "Good Rule")).toBe(true);
  });

  it("reports path depth where min > max", () => {
    const src = `
      RULE "Bad Depth"
      SEVERITY ERROR
      MATCH (c:Client) -[:Calls*10..5]-> (db:Database)
      YIELD "bad" WITH c, db
    `;
    const { errors } = parse(src);
    expect(errors.some(e => e.includes("min") && e.includes("max"))).toBe(true);
  });

  it("empty source returns no rules and no errors", () => {
    const { rules, errors } = parse("");
    expect(rules).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
