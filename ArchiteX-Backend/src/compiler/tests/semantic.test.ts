import { describe, it, expect } from "vitest";
import { Lexer } from "../lexer/lexer";
import { Parser } from "../parser/Parser";
import { SemanticAnalyser } from "../semantic/SemanticAnalyser";
import { SemanticDiagnosticCode } from "../diagnostics/semanticDiagnostics";

/**
 * Semantic Analyser tests.
 *
 * Each test exercises one or more of the 8 checks from ArchQL_v3_2.md §20.
 * Tests use real ArchQL source strings → Lexer → Parser → SemanticAnalyser.
 */

function analyse(source: string) {
  const { tokens } = new Lexer(source).tokenize();
  const { rules } = new Parser(tokens).parse();
  const analyser = new SemanticAnalyser();
  return analyser.analyse(rules);
}

function codes(source: string): SemanticDiagnosticCode[] {
  return analyse(source).diagnostics.map((d) => d.code);
}

// ---------------------------------------------------------------------------
// Happy paths — all spec examples must produce no semantic errors
// ---------------------------------------------------------------------------

describe("SemanticAnalyser — valid rules (no diagnostics)", () => {

  it("accepts a simple rule with no WHERE or YIELD WITH", () => {
    const src = `
      RULE "Direct DB Access"
      SEVERITY ERROR
      MATCH (c:Client) -> (db:Database)
      YIELD "Client talks directly to DB" WITH c, db
    `;
    const { validRules, diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
    expect(validRules).toHaveLength(1);
  });

  it("accepts OPTIONAL + WHERE NOT EXISTS(var) — §24 Rule 4", () => {
    const src = `
      RULE "Unauthenticated API Gateway"
      SEVERITY ERROR
      MATCH (api:APIGateway)
      OPTIONAL (api) -> (auth:AuthService)
      WHERE NOT EXISTS(auth)
      YIELD "API Gateway has no auth" WITH api
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts COUNT BY where anchor is in MATCH — §24 Rule 1", () => {
    const src = `
      RULE "Single Server Behind Load Balancer"
      SEVERITY ERROR
      MATCH (lb:LoadBalancer) -> (srv:Server)
      WHERE COUNT(srv) BY lb < 2
      YIELD "LB has fewer than 2 servers" WITH lb, srv
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts SIMULATE variable used in WHERE", () => {
    const src = `
      RULE "Server CPU Exceeds Threshold"
      SEVERITY WARNING
      MATCH (srv:Server)
      SIMULATE maxCPU = 85
      WHERE srv.cpu > maxCPU
      YIELD "CPU exceeds threshold" WITH srv
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts DEGREE in WHERE — §24 Rule 13", () => {
    const src = `
      RULE "God Service"
      SEVERITY WARNING
      MATCH (srv:Server)
      WHERE DEGREE(srv) > 8
      YIELD "Too many connections" WITH srv
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts EXISTS path with anonymous nodes — §24 Rule 3", () => {
    const src = `
      RULE "No Cache Before Database"
      SEVERITY WARNING
      MATCH (srv:Server) -> (db:Database)
      WHERE NOT EXISTS((srv) -[:Reads*1..2]-> (:Cache))
      YIELD "No cache layer" WITH srv, db
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts EXISTS path with bound alias in both endpoints — §24 Rule 12", () => {
    const src = `
      RULE "Missing Circuit Breaker"
      SEVERITY WARNING
      MATCH (a:Server) -> (b:Server)
      WHERE NOT EXISTS((a) -> (:CircuitBreaker) -> (b))
      YIELD "No circuit breaker" WITH a, b
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts SUM with property accessor", () => {
    const src = `
      RULE "High Latency Sum"
      SEVERITY WARNING
      MATCH (srv:Server) -> (db:Database)
      WHERE SUM(srv.latency) BY db > 500
      YIELD "Total latency too high" WITH srv, db
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts multiple rules with distinct names", () => {
    const src = `
      RULE "Rule A"
      SEVERITY ERROR
      MATCH (a:Server)
      YIELD "msg a" WITH a

      RULE "Rule B"
      SEVERITY WARNING
      MATCH (b:Database)
      YIELD "msg b" WITH b
    `;
    const { validRules, diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
    expect(validRules).toHaveLength(2);
  });

  it("accepts AND compound WHERE with bound vars — §25 Complete Example", () => {
    const src = `
      RULE "Client Reads Directly From Public Database"
      SEVERITY ERROR
      MATCH (c:Client) -[:Reads]-> (db:Database)
      OPTIONAL (c) -> (gw:APIGateway)
      WHERE NOT EXISTS(gw)
        AND db.public = true
      YIELD "Client reads directly from a public database" WITH c, db
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts edge alias used in property access", () => {
    const src = `
      RULE "Unencrypted Database Connection"
      SEVERITY ERROR
      MATCH (srv:Server) -[conn:Writes]-> (db:Database)
      WHERE conn.encrypted = false
      YIELD "Unencrypted write" WITH srv, db
    `;
    const { diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S001 — Unbound variable in WHERE
// ---------------------------------------------------------------------------

describe("S001 — Unbound variable in WHERE", () => {

  it("rejects property access on unbound variable", () => {
    const src = `
      RULE "Bad WHERE"
      SEVERITY ERROR
      MATCH (a:Server)
      WHERE ghost.cpu > 80
      YIELD "bad" WITH a
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE);
  });

  it("rejects identifier reference on unbound variable", () => {
    const src = `
      RULE "Bad Identifier"
      SEVERITY ERROR
      MATCH (a:Server)
      WHERE ghost = true
      YIELD "bad" WITH a
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE);
  });

  it("rejects COUNT on unbound variable", () => {
    const src = `
      RULE "Bad COUNT"
      SEVERITY ERROR
      MATCH (a:Server)
      WHERE COUNT(ghost) < 2
      YIELD "bad" WITH a
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE);
  });

  it("rejects EXISTS(unbound_var) — variable form", () => {
    const src = `
      RULE "Bad EXISTS Variable"
      SEVERITY ERROR
      MATCH (a:Server)
      WHERE NOT EXISTS(ghost)
      YIELD "bad" WITH a
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE);
  });

  it("accepts OPTIONAL variable in WHERE EXISTS (it IS bound)", () => {
    const src = `
      RULE "Good OPTIONAL"
      SEVERITY ERROR
      MATCH (api:APIGateway)
      OPTIONAL (api) -> (auth:AuthService)
      WHERE NOT EXISTS(auth)
      YIELD "no auth" WITH api
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.UNBOUND_VARIABLE_WHERE);
  });
});

// ---------------------------------------------------------------------------
// S002 — Unbound variable in YIELD WITH
// ---------------------------------------------------------------------------

describe("S002 — Unbound variable in YIELD WITH", () => {

  it("rejects YIELD WITH an unbound variable", () => {
    const src = `
      RULE "Bad YIELD"
      SEVERITY ERROR
      MATCH (a:Server)
      YIELD "msg" WITH a, ghost
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.UNBOUND_VARIABLE_YIELD);
  });

  it("accepts YIELD WITH only MATCH-bound variables", () => {
    const src = `
      RULE "Good YIELD"
      SEVERITY ERROR
      MATCH (a:Server) -> (b:Database)
      YIELD "msg" WITH a, b
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.UNBOUND_VARIABLE_YIELD);
  });

  it("accepts YIELD WITH OPTIONAL-bound variables", () => {
    const src = `
      RULE "YIELD OPTIONAL Bound"
      SEVERITY WARNING
      MATCH (api:APIGateway)
      OPTIONAL (api) -> (auth:AuthService)
      WHERE EXISTS(auth)
      YIELD "api has auth" WITH api, auth
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.UNBOUND_VARIABLE_YIELD);
  });

  it("accepts YIELD ONCE with no WITH vars", () => {
    const src = `
      RULE "Global Warning"
      SEVERITY INFO
      MATCH (srv:Server)
      YIELD "Global observation" ONCE
    `;
    const result = codes(src);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// S003 — BY anchor must be in MATCH, not OPTIONAL
// ---------------------------------------------------------------------------

describe("S003 — BY anchor must be bound in MATCH", () => {

  it("rejects BY anchor bound only in OPTIONAL", () => {
    const src = `
      RULE "Bad BY Anchor"
      SEVERITY ERROR
      MATCH (srv:Server)
      OPTIONAL (srv) -> (lb:LoadBalancer)
      WHERE COUNT(srv) BY lb < 2
      YIELD "bad" WITH srv
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.BY_ANCHOR_NOT_IN_MATCH);
  });

  it("accepts BY anchor bound in MATCH", () => {
    const src = `
      RULE "Good BY Anchor"
      SEVERITY ERROR
      MATCH (lb:LoadBalancer) -> (srv:Server)
      WHERE COUNT(srv) BY lb < 2
      YIELD "SPOF" WITH lb, srv
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.BY_ANCHOR_NOT_IN_MATCH);
  });

  it("rejects BY anchor that is completely unbound", () => {
    const src = `
      RULE "Totally Unbound BY"
      SEVERITY ERROR
      MATCH (srv:Server)
      WHERE COUNT(srv) BY ghost < 2
      YIELD "bad" WITH srv
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.BY_ANCHOR_NOT_IN_MATCH);
  });
});

// ---------------------------------------------------------------------------
// S004 — DEGREE argument must be bound
// ---------------------------------------------------------------------------

describe("S004 — DEGREE argument must be bound", () => {

  it("rejects DEGREE on unbound variable", () => {
    const src = `
      RULE "Bad DEGREE"
      SEVERITY WARNING
      MATCH (srv:Server)
      WHERE DEGREE(ghost) > 8
      YIELD "bad" WITH srv
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.DEGREE_UNBOUND_ARGUMENT);
  });

  it("accepts DEGREE on MATCH-bound variable", () => {
    const src = `
      RULE "Good DEGREE"
      SEVERITY WARNING
      MATCH (srv:Server)
      WHERE DEGREE(srv) > 8
      YIELD "God service" WITH srv
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.DEGREE_UNBOUND_ARGUMENT);
  });
});

// ---------------------------------------------------------------------------
// S005 — EXISTS path aliases must be bound
// ---------------------------------------------------------------------------

describe("S005 — EXISTS path endpoints must be bound", () => {

  it("rejects EXISTS path with unbound alias as endpoint", () => {
    const src = `
      RULE "Bad EXISTS Path"
      SEVERITY ERROR
      MATCH (a:Server)
      WHERE NOT EXISTS((ghost) -> (:Cache))
      YIELD "bad" WITH a
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.EXISTS_ENDPOINT_UNBOUND);
  });

  it("accepts EXISTS path with anonymous typed nodes only", () => {
    const src = `
      RULE "Anonymous EXISTS Path"
      SEVERITY ERROR
      MATCH (c:Client) -> (srv:Server)
      WHERE NOT EXISTS((:LoadBalancer) -> (srv))
      YIELD "no lb" WITH srv
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.EXISTS_ENDPOINT_UNBOUND);
  });

  it("accepts EXISTS path with both endpoints bound", () => {
    const src = `
      RULE "Both Endpoints Bound"
      SEVERITY ERROR
      MATCH (a:Server) -> (b:Server)
      WHERE NOT EXISTS((a) -> (:CircuitBreaker) -> (b))
      YIELD "no cb" WITH a, b
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.EXISTS_ENDPOINT_UNBOUND);
  });
});

// ---------------------------------------------------------------------------
// S006 — SIMULATE must not shadow bound aliases
// ---------------------------------------------------------------------------

describe("S006 — SIMULATE variable must not shadow bound alias", () => {

  it("rejects SIMULATE variable that shadows a MATCH alias", () => {
    const src = `
      RULE "SIMULATE Shadow"
      SEVERITY WARNING
      MATCH (srv:Server)
      SIMULATE srv = 100
      WHERE srv.cpu > srv
      YIELD "bad" WITH srv
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.SIMULATE_SHADOWS_ALIAS);
  });

  it("accepts SIMULATE variable with a distinct name", () => {
    const src = `
      RULE "Good SIMULATE"
      SEVERITY WARNING
      MATCH (srv:Server)
      SIMULATE maxCPU = 85
      WHERE srv.cpu > maxCPU
      YIELD "threshold exceeded" WITH srv
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.SIMULATE_SHADOWS_ALIAS);
  });
});

// ---------------------------------------------------------------------------
// S007 — Duplicate rule names
// ---------------------------------------------------------------------------

describe("S007 — Duplicate rule names", () => {

  it("rejects a second rule with the same name", () => {
    const src = `
      RULE "Same Name"
      SEVERITY ERROR
      MATCH (a:Server)
      YIELD "first" WITH a

      RULE "Same Name"
      SEVERITY WARNING
      MATCH (b:Database)
      YIELD "second" WITH b
    `;
    const { validRules, diagnostics } = analyse(src);
    expect(diagnostics.some(d => d.code === SemanticDiagnosticCode.DUPLICATE_RULE_NAME)).toBe(true);
    // Only the first occurrence is valid
    expect(validRules).toHaveLength(1);
    expect(validRules[0].severity).toBe("ERROR");
  });

  it("accepts multiple rules with unique names", () => {
    const src = `
      RULE "Rule One"
      SEVERITY ERROR
      MATCH (a:Server)
      YIELD "one" WITH a

      RULE "Rule Two"
      SEVERITY WARNING
      MATCH (b:Database)
      YIELD "two" WITH b
    `;
    const { validRules, diagnostics } = analyse(src);
    expect(diagnostics).toHaveLength(0);
    expect(validRules).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// S008 — SUM/AVG/MIN/MAX require property accessor
// ---------------------------------------------------------------------------

describe("S008 — Aggregate functions require property accessor", () => {

  it("rejects SUM(var) without property", () => {
    const src = `
      RULE "Bad SUM"
      SEVERITY WARNING
      MATCH (srv:Server) -> (db:Database)
      WHERE SUM(srv) > 100
      YIELD "bad" WITH srv, db
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.AGGREGATE_MISSING_PROPERTY);
  });

  it("rejects AVG(var) without property", () => {
    const src = `
      RULE "Bad AVG"
      SEVERITY WARNING
      MATCH (srv:Server) -> (db:Database)
      WHERE AVG(srv) > 50
      YIELD "bad" WITH srv, db
    `;
    const result = codes(src);
    expect(result).toContain(SemanticDiagnosticCode.AGGREGATE_MISSING_PROPERTY);
  });

  it("accepts SUM(var.prop)", () => {
    const src = `
      RULE "Good SUM"
      SEVERITY WARNING
      MATCH (srv:Server) -> (db:Database)
      WHERE SUM(srv.latency) BY db > 500
      YIELD "high latency" WITH srv, db
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.AGGREGATE_MISSING_PROPERTY);
  });

  it("accepts COUNT(var) without property — COUNT does not require one", () => {
    const src = `
      RULE "COUNT no property"
      SEVERITY ERROR
      MATCH (lb:LoadBalancer) -> (srv:Server)
      WHERE COUNT(srv) BY lb < 2
      YIELD "SPOF" WITH lb, srv
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.AGGREGATE_MISSING_PROPERTY);
  });

  it("accepts DEGREE(var) without property — DEGREE does not require one", () => {
    const src = `
      RULE "DEGREE no property"
      SEVERITY WARNING
      MATCH (srv:Server)
      WHERE DEGREE(srv) > 8
      YIELD "God service" WITH srv
    `;
    const result = codes(src);
    expect(result).not.toContain(SemanticDiagnosticCode.AGGREGATE_MISSING_PROPERTY);
  });
});

// ---------------------------------------------------------------------------
// Integration — invalid rules are excluded from validRules
// ---------------------------------------------------------------------------

describe("Integration — invalid rules excluded from validRules", () => {

  it("excludes rule with errors from validRules, keeps valid siblings", () => {
    const src = `
      RULE "Bad Rule"
      SEVERITY ERROR
      MATCH (a:Server)
      WHERE ghost.cpu > 80
      YIELD "bad" WITH a

      RULE "Good Rule"
      SEVERITY WARNING
      MATCH (b:Database)
      YIELD "good" WITH b
    `;
    const { validRules, diagnostics } = analyse(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(validRules).toHaveLength(1);
    expect(validRules[0].name).toBe("Good Rule");
  });

  it("returns empty validRules for completely broken source", () => {
    const src = `
      RULE "All Bad"
      SEVERITY ERROR
      MATCH (a:Server)
      WHERE ghost = true
      YIELD "bad" WITH missing
    `;
    const { validRules } = analyse(src);
    expect(validRules).toHaveLength(0);
  });
});
