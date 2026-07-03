/**
 * AST Types for the ArchQL compiler.
 *
 * Structure is derived EXACTLY from ArchQL_v3_2.md §19 "AST Design".
 * Do not add or remove fields without a spec change.
 *
 * Immutable by convention — the parser produces these, the semantic
 * analyser reads them, and the matcher/evaluator consumes them.
 * No component should mutate an AST node after construction.
 */

import type { SeverityLevel } from "../../shared/severity";

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

export type LiteralValue = string | number | boolean | LiteralValue[];

export interface StringLiteral  { readonly kind: "string";  readonly value: string; }
export interface NumberLiteral  { readonly kind: "number";  readonly value: number; }
export interface BooleanLiteral { readonly kind: "boolean"; readonly value: boolean; }
export interface ListLiteral    { readonly kind: "list";    readonly values: LiteralValue[]; }

export type Literal =
  | StringLiteral
  | NumberLiteral
  | BooleanLiteral
  | ListLiteral;

// ---------------------------------------------------------------------------
// Pattern nodes — used in MATCH, OPTIONAL, and EXISTS paths
// ---------------------------------------------------------------------------

/**
 * NodePatternNode — §19, §13
 *
 * Examples:
 *  (srv:Server)          → alias="srv", type="Server"
 *  (srv:Server {public:true}) → alias="srv", type="Server", properties=Map
 *  (:Cache)              → alias=null, type="Cache"
 *  (srv)                 → alias="srv", type=null   (bound alias, no type constraint)
 *  ()                    → alias=null, type=null
 */
export interface NodePatternNode {
  readonly kind: "NodePattern";
  readonly alias: string | null;
  readonly type: string | null;
  readonly properties: ReadonlyMap<string, Literal>;
}

/**
 * EdgePatternNode — §19, §14
 *
 * Examples:
 *  ->                           simple directed, no type
 *  -[conn:Writes]->             alias="conn", type="Writes"
 *  -[:Reads*1..5]->             alias=null, type="Reads", depth={min:1, max:5}
 *  --                           undirected
 */
export interface PathDepthNode {
  readonly min: number;            // default 1
  readonly max: number | null;     // null = engine default cap (10)
}

export interface EdgePatternNode {
  readonly kind: "EdgePattern";
  readonly alias: string | null;
  readonly type: string | null;
  readonly direction: "directed" | "undirected";
  readonly depth: PathDepthNode | null;
  readonly properties: ReadonlyMap<string, Literal>;
}

/**
 * A full linear pattern — a sequence of alternating NodePatternNodes
 * and EdgePatternNodes.
 * e.g.  (a:Server) -> (b:Server) -> (c:Database)
 *        NodePattern EdgePattern NodePattern EdgePattern NodePattern
 */
export interface PatternNode {
  readonly kind: "Pattern";
  readonly elements: ReadonlyArray<NodePatternNode | EdgePatternNode>;
}

// ---------------------------------------------------------------------------
// SIMULATE binding  — §9
// ---------------------------------------------------------------------------

export interface SimulateBinding {
  readonly variable: string;
  readonly value: Literal;
}

// ---------------------------------------------------------------------------
// Expressions — §18 EBNF
// ---------------------------------------------------------------------------

export interface PropertyAccessExpr {
  readonly kind: "PropertyAccess";
  readonly variable: string;    // e.g. "srv"
  readonly property: string;    // e.g. "cpu"
}

export interface IdentifierExpr {
  readonly kind: "Identifier";
  readonly name: string;
}

export interface LiteralExpr {
  readonly kind: "Literal";
  readonly value: Literal;
}

export interface FunctionCallNode {
  readonly kind: "FunctionCall";
  readonly name: "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "DEGREE";
  /** Bound variable name (e.g. "srv") */
  readonly argument: string;
  /** Property accessor for SUM/AVG/MIN/MAX: var.prop → property = "prop" */
  readonly property: string | null;
  /** BY anchor variable (null = global aggregation) */
  readonly groupBy: string | null;
}

export type Expression =
  | PropertyAccessExpr
  | IdentifierExpr
  | LiteralExpr
  | FunctionCallNode;

// ---------------------------------------------------------------------------
// EXISTS expression — §11, §18 EBNF
// ---------------------------------------------------------------------------

export interface ExistsPathNode {
  readonly from: NodePatternNode;
  readonly edge: EdgePatternNode | null;
  readonly to: NodePatternNode | null;
}

export interface ExistsExprNode {
  readonly kind: "ExistsExpr";
  /**
   * "variable"  → EXISTS(auth)
   * "property"  → EXISTS(srv.cpu)
   * "path"      → EXISTS((a:Server) -> (:Cache))
   */
  readonly form: "variable" | "property" | "path";
  /** Set when form="variable" or form="property" */
  readonly variable: string | null;
  readonly propertyName: string | null;
  /** Set when form="path" */
  readonly path: ExistsPathNode | null;
}

// ---------------------------------------------------------------------------
// Boolean expressions (WHERE clause) — §18 EBNF
// ---------------------------------------------------------------------------

export interface ComparisonExpr {
  readonly kind: "Comparison";
  readonly left: Expression;
  readonly operator: "=" | "!=" | "<" | ">" | "<=" | ">=" | "IN" | "CONTAINS";
  readonly right: Expression;
}

export interface NotExpr {
  readonly kind: "Not";
  readonly operand: BooleanExpr;
}

export interface AndExpr {
  readonly kind: "And";
  readonly left: BooleanExpr;
  readonly right: BooleanExpr;
}

export interface OrExpr {
  readonly kind: "Or";
  readonly left: BooleanExpr;
  readonly right: BooleanExpr;
}

export type BooleanExpr =
  | ComparisonExpr
  | ExistsExprNode
  | NotExpr
  | AndExpr
  | OrExpr;

// ---------------------------------------------------------------------------
// YIELD clause — §18 EBNF
// ---------------------------------------------------------------------------

export interface YieldNode {
  readonly kind: "Yield";
  readonly message: string;
  readonly withVars: ReadonlyArray<string>;
  readonly once: boolean;
}

// ---------------------------------------------------------------------------
// Top-level Rule AST — §19
// ---------------------------------------------------------------------------

/**
 * RuleNode — the complete, parsed representation of one ArchQL rule.
 * Produced by the Parser after consuming one RULE…YIELD block.
 * Consumed by the Semantic Analyser then the Matcher/Evaluator.
 */
export interface RuleNode {
  readonly kind: "Rule";
  readonly name: string;
  readonly severity: SeverityLevel;

  /** The mandatory MATCH clause */
  readonly matchClause: PatternNode;

  /** Zero or more OPTIONAL clauses, in source order */
  readonly optionalClauses: ReadonlyArray<PatternNode>;

  /** Zero or more SIMULATE bindings */
  readonly simulateBindings: ReadonlyArray<SimulateBinding>;

  /** The WHERE clause, or null if absent */
  readonly whereClause: BooleanExpr | null;

  readonly yieldClause: YieldNode;

  /** Source location — for diagnostics */
  readonly line: number;
  readonly column: number;
}
