/**
 * ArchQL Parser
 *
 * Consumes Token[] from the Lexer and produces RuleNode[].
 *
 * Spec references:
 *  - §5  Rule Structure (mandatory clause ordering)
 *  - §13 Node Patterns
 *  - §14 Edge Patterns
 *  - §15 Property Filters
 *  - §16 Path Depth
 *  - §18 EBNF Grammar (authoritative)
 *  - §19 AST Design
 *
 * Design rules:
 *  - Recursive descent — one method per grammar production.
 *  - Error recovery: on a parse error the current rule is abandoned
 *    (via synchronise()), diagnostics are collected, and parsing
 *    continues at the next RULE keyword to find more errors.
 *  - No knowledge of HTTP, Express, or graph internals.
 *  - No side effects — pure Token[] → RuleNode[] transformation.
 */

import { TokenType, type Token } from "../lexer/token";
import {
  ParseDiagnosticCode,
  type ParseDiagnostic,
} from "../diagnostics/parseDiagnostics";
import type {
  RuleNode,
  PatternNode,
  NodePatternNode,
  EdgePatternNode,
  PathDepthNode,
  SimulateBinding,
  BooleanExpr,
  ComparisonExpr,
  ExistsExprNode,
  ExistsPathNode,
  NotExpr,
  AndExpr,
  OrExpr,
  YieldNode,
  Expression,
  PropertyAccessExpr,
  IdentifierExpr,
  LiteralExpr,
  FunctionCallNode,
  Literal,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
} from "../ast/RuleAST";
import type { SeverityLevel } from "../../shared/severity";

const SEVERITY_SET = new Set<string>(["ERROR", "WARNING", "INFO", "HINT"]);

export interface ParseResult {
  rules: RuleNode[];
  diagnostics: ParseDiagnostic[];
}

export class Parser {
  private pos = 0;
  private readonly diagnostics: ParseDiagnostic[] = [];

  constructor(private readonly tokens: Token[]) {}

  // -------------------------------------------------------------------------
  // Public entry point
  // -------------------------------------------------------------------------

  parse(): ParseResult {
    const rules: RuleNode[] = [];

    while (!this.isAtEnd()) {
      if (this.check(TokenType.RULE)) {
        const rule = this.parseRule();
        if (rule) rules.push(rule);
      } else {
        // Skip unexpected top-level tokens
        this.errorAt(
          this.peek(),
          ParseDiagnosticCode.UNEXPECTED_TOKEN,
          `Expected 'RULE', got '${this.peek().lexeme}'`
        );
        this.advance();
      }
    }

    return { rules, diagnostics: this.diagnostics };
  }

  // -------------------------------------------------------------------------
  // Rule — §5
  //
  // RULE "<name>"
  // SEVERITY <level>
  // MATCH <pattern>
  // [OPTIONAL <pattern>]*
  // [SIMULATE <var> = <value> [, <var> = <value>]*]
  // [WHERE <boolExpr>]
  // YIELD "<message>" [WITH <vars>] [ONCE]
  // -------------------------------------------------------------------------

  private parseRule(): RuleNode | null {
    const ruleTok = this.consume(TokenType.RULE, "Expected 'RULE'");
    if (!ruleTok) return null;

    const nameTok = this.consume(TokenType.STRING, "Expected rule name string after 'RULE'");
    if (!nameTok) { this.synchronise(); return null; }
    const name = this.extractString(nameTok.lexeme);

    // SEVERITY
    if (!this.consume(TokenType.SEVERITY, "Expected 'SEVERITY' after rule name")) {
      this.synchronise(); return null;
    }
    const severityTok = this.peek();
    const severity = this.parseSeverity();
    if (!severity) { this.synchronise(); return null; }

    // MATCH
    if (!this.consume(TokenType.MATCH, "Expected 'MATCH' after SEVERITY")) {
      this.synchronise(); return null;
    }
    const matchClause = this.parsePattern();
    if (!matchClause) { this.synchronise(); return null; }

    // OPTIONAL* — zero or more
    const optionalClauses: PatternNode[] = [];
    while (this.check(TokenType.OPTIONAL)) {
      this.advance(); // consume OPTIONAL
      const opt = this.parsePattern();
      if (!opt) { this.synchronise(); return null; }
      optionalClauses.push(opt);
    }

    // SIMULATE? — optional, multiple bindings on one line
    const simulateBindings: SimulateBinding[] = [];
    if (this.check(TokenType.SIMULATE)) {
      this.advance(); // consume SIMULATE
      const bindings = this.parseSimulateBindings();
      if (bindings === null) { this.synchronise(); return null; }
      simulateBindings.push(...bindings);
    }

    // WHERE? — optional
    let whereClause: BooleanExpr | null = null;
    if (this.check(TokenType.WHERE)) {
      this.advance(); // consume WHERE
      whereClause = this.parseBooleanExpr();
      if (!whereClause) { this.synchronise(); return null; }
    }

    // YIELD — mandatory
    if (!this.consume(TokenType.YIELD, "Expected 'YIELD'")) {
      this.synchronise(); return null;
    }
    const yieldClause = this.parseYield();
    if (!yieldClause) { this.synchronise(); return null; }

    return {
      kind: "Rule",
      name,
      severity,
      matchClause,
      optionalClauses,
      simulateBindings,
      whereClause,
      yieldClause,
      sourceFile: "",   // stamped by RuleLoader after parsing
      line: ruleTok.line,
      column: ruleTok.column,
    };
  }

  // -------------------------------------------------------------------------
  // SEVERITY
  // -------------------------------------------------------------------------

  private parseSeverity(): SeverityLevel | null {
    const tok = this.peek();
    const candidates = [
      TokenType.ERROR,
      TokenType.WARNING,
      TokenType.INFO,
      TokenType.HINT,
    ];
    for (const tt of candidates) {
      if (this.check(tt)) {
        this.advance();
        return tok.lexeme as SeverityLevel;
      }
    }
    this.errorAt(
      tok,
      ParseDiagnosticCode.INVALID_SEVERITY,
      `Expected severity level (ERROR, WARNING, INFO, HINT), got '${tok.lexeme}'`
    );
    return null;
  }

  // -------------------------------------------------------------------------
  // Pattern — §12, §13, §14
  //
  // A pattern is:  NodePattern (EdgePattern NodePattern)*
  // -------------------------------------------------------------------------

  private parsePattern(): PatternNode | null {
    const elements: Array<NodePatternNode | EdgePatternNode> = [];

    const firstNode = this.parseNodePattern();
    if (!firstNode) return null;
    elements.push(firstNode);

    // Keep consuming edge→node pairs as long as we see an edge start
    while (this.checkEdgeStart()) {
      const edge = this.parseEdgePattern();
      if (!edge) return null;
      elements.push(edge);

      const nextNode = this.parseNodePattern();
      if (!nextNode) return null;
      elements.push(nextNode);
    }

    return { kind: "Pattern", elements };
  }

  // -------------------------------------------------------------------------
  // Node pattern — §13
  //
  // "(" alias? (":" Type)? PropertyMap? ")"
  // -------------------------------------------------------------------------

  private parseNodePattern(): NodePatternNode | null {
    if (!this.consume(TokenType.LEFT_PAREN, "Expected '(' to start node pattern")) {
      return null;
    }

    let alias: string | null = null;
    let type: string | null = null;
    let properties: Map<string, Literal> = new Map();

    // alias? — IDENTIFIER not followed immediately by COLON (which would mean :Type)
    if (this.check(TokenType.IDENTIFIER)) {
      // Could be alias, or just peek ahead
      const next = this.tokens[this.pos + 1];
      // alias if next is ':', ')', or '{'
      alias = this.advance().lexeme;
    }

    // (:Type) form — colon immediately or after alias
    if (this.check(TokenType.COLON)) {
      this.advance(); // consume ':'
      const typeTok = this.consume(TokenType.IDENTIFIER, "Expected type name after ':'");
      if (!typeTok) return null;
      type = typeTok.lexeme;
    }

    // PropertyMap?
    if (this.check(TokenType.LEFT_BRACE)) {
      const props = this.parsePropertyMap();
      if (!props) return null;
      properties = props;
    }

    if (!this.consume(TokenType.RIGHT_PAREN, "Expected ')' to close node pattern")) {
      return null;
    }

    return { kind: "NodePattern", alias, type, properties };
  }

  // -------------------------------------------------------------------------
  // Edge pattern — §14
  //
  // "-[" Alias? (":" Type)? PathDepth? PropertyMap? "]->"
  // | "->"
  // | "--"
  // -------------------------------------------------------------------------

  private parseEdgePattern(): EdgePatternNode | null {
    const emptyProps = new Map<string, Literal>();

    // Simple directed edge: ->
    if (this.check(TokenType.ARROW)) {
      this.advance();
      return {
        kind: "EdgePattern",
        alias: null,
        type: null,
        direction: "directed",
        depth: null,
        properties: emptyProps,
      };
    }

    // Undirected edge: --
    if (this.check(TokenType.UNDIRECTED_EDGE)) {
      this.advance();
      return {
        kind: "EdgePattern",
        alias: null,
        type: null,
        direction: "undirected",
        depth: null,
        properties: emptyProps,
      };
    }

    // Complex edge: -[ ... ]->
    // Must start with DASH
    if (!this.consume(TokenType.DASH, "Expected '-', '->', or '--' for edge pattern")) {
      return null;
    }
    if (!this.consume(TokenType.LEFT_BRACKET, "Expected '[' after '-' in edge pattern")) {
      return null;
    }

    let alias: string | null = null;
    let type: string | null = null;
    let depth: PathDepthNode | null = null;
    let properties: Map<string, Literal> = new Map();

    // alias?
    if (this.check(TokenType.IDENTIFIER)) {
      const next = this.tokens[this.pos + 1];
      if (next && (next.type === TokenType.COLON || next.type === TokenType.RIGHT_BRACKET || next.type === TokenType.STAR)) {
        alias = this.advance().lexeme;
      } else {
        alias = this.advance().lexeme;
      }
    }

    // :Type?
    if (this.check(TokenType.COLON)) {
      this.advance();
      const typeTok = this.consume(TokenType.IDENTIFIER, "Expected edge type name after ':'");
      if (!typeTok) return null;
      type = typeTok.lexeme;
    }

    // PathDepth?  *  |  *min  |  *min..max
    if (this.check(TokenType.STAR)) {
      this.advance(); // consume *
      depth = this.parsePathDepth();
      if (!depth) return null;
    }

    // PropertyMap?
    if (this.check(TokenType.LEFT_BRACE)) {
      const props = this.parsePropertyMap();
      if (!props) return null;
      properties = props;
    }

    if (!this.consume(TokenType.RIGHT_BRACKET, "Expected ']' to close edge pattern")) {
      return null;
    }
    if (!this.consume(TokenType.ARROW, "Expected '->' after edge pattern '...]'")) {
      return null;
    }

    return {
      kind: "EdgePattern",
      alias,
      type,
      direction: "directed",
      depth,
      properties,
    };
  }

  // -------------------------------------------------------------------------
  // Path depth — §16
  //
  // * alone       → min=1, max=null (engine default cap)
  // *n            → min=n, max=n
  // *n..m         → min=n, max=m
  // -------------------------------------------------------------------------

  private parsePathDepth(): PathDepthNode | null {
    // Check if next token is a number
    if (!this.check(TokenType.NUMBER)) {
      // bare * → min=1, max=null
      return { min: 1, max: null };
    }

    const minTok = this.advance();
    const min = parseFloat(minTok.lexeme);

    if (!this.check(TokenType.DOT_DOT)) {
      // *n form
      return { min, max: min };
    }

    this.advance(); // consume '..'

    const maxTok = this.consume(TokenType.NUMBER, "Expected max value after '..'");
    if (!maxTok) {
      this.errorAt(this.peek(), ParseDiagnosticCode.INVALID_PATH_DEPTH, "Expected number after '..'");
      return null;
    }
    const max = parseFloat(maxTok.lexeme);

    if (min > max) {
      this.errorAt(minTok, ParseDiagnosticCode.INVALID_PATH_DEPTH,
        `Path depth min (${min}) must not exceed max (${max})`);
      return null;
    }

    return { min, max };
  }

  // -------------------------------------------------------------------------
  // Property map — §15
  //
  // "{" key ":" value ("," key ":" value)* "}"
  // -------------------------------------------------------------------------

  private parsePropertyMap(): Map<string, Literal> | null {
    this.advance(); // consume '{'

    const map = new Map<string, Literal>();

    if (this.check(TokenType.RIGHT_BRACE)) {
      this.advance();
      return map;
    }

    do {
      const keyTok = this.consume(TokenType.IDENTIFIER, "Expected property name");
      if (!keyTok) return null;

      if (!this.consume(TokenType.COLON, `Expected ':' after property name '${keyTok.lexeme}'`)) {
        return null;
      }

      const val = this.parseLiteral();
      if (!val) return null;

      map.set(keyTok.lexeme, val);
    } while (this.match(TokenType.COMMA));

    if (!this.consume(TokenType.RIGHT_BRACE, "Expected '}' to close property map")) {
      return null;
    }

    return map;
  }

  // -------------------------------------------------------------------------
  // SIMULATE bindings — §9
  //
  // SIMULATE var = value [, var = value]*
  // -------------------------------------------------------------------------

  private parseSimulateBindings(): SimulateBinding[] | null {
    const bindings: SimulateBinding[] = [];

    do {
      const varTok = this.consume(TokenType.IDENTIFIER, "Expected simulation variable name");
      if (!varTok) return null;

      if (!this.consume(TokenType.EQUAL, `Expected '=' after simulation variable '${varTok.lexeme}'`)) {
        return null;
      }

      const val = this.parseLiteral();
      if (!val) return null;

      // Spec: simulation values must be numbers
      if (val.kind !== "number") {
        this.errorAt(
          this.previous(),
          ParseDiagnosticCode.INVALID_SIMULATE_VALUE,
          `SIMULATE value for '${varTok.lexeme}' must be a number, got ${val.kind}`
        );
        return null;
      }

      bindings.push({ variable: varTok.lexeme, value: val });
    } while (this.match(TokenType.COMMA));

    return bindings;
  }

  // -------------------------------------------------------------------------
  // Boolean expression — §18 EBNF
  //
  // Precedence (low → high):
  //   OR  <  AND  <  NOT  <  Comparison / EXISTS
  // -------------------------------------------------------------------------

  private parseBooleanExpr(): BooleanExpr | null {
    return this.parseOr();
  }

  private parseOr(): BooleanExpr | null {
    let left = this.parseAnd();
    if (!left) return null;

    while (this.check(TokenType.OR)) {
      this.advance(); // consume OR
      const right = this.parseAnd();
      if (!right) return null;
      const node: OrExpr = { kind: "Or", left, right };
      left = node;
    }

    return left;
  }

  private parseAnd(): BooleanExpr | null {
    let left = this.parseFactor();
    if (!left) return null;

    while (this.check(TokenType.AND)) {
      this.advance(); // consume AND
      const right = this.parseFactor();
      if (!right) return null;
      const node: AndExpr = { kind: "And", left, right };
      left = node;
    }

    return left;
  }

  private parseFactor(): BooleanExpr | null {
    // NOT BooleanFactor
    if (this.check(TokenType.NOT)) {
      this.advance();
      const operand = this.parseFactor();
      if (!operand) return null;
      const node: NotExpr = { kind: "Not", operand };
      return node;
    }

    // Grouped: ( BooleanExpr )
    if (this.check(TokenType.LEFT_PAREN)) {
      // Peek ahead to see if this is an EXISTS path form
      // If it starts with ( and is NOT a node pattern inside EXISTS,
      // it's a grouped boolean expression.
      // We handle this carefully: if we see ( immediately, it might be
      // a grouped expr — but EXISTS handles its own parens separately.
      this.advance(); // consume '('
      const expr = this.parseBooleanExpr();
      if (!expr) return null;
      if (!this.consume(TokenType.RIGHT_PAREN, "Expected ')' to close grouped expression")) {
        return null;
      }
      return expr;
    }

    // EXISTS(...)
    if (this.check(TokenType.EXISTS)) {
      return this.parseExistsExpr();
    }

    // Comparison: Expression Operator Expression
    return this.parseComparison();
  }

  private parseComparison(): ComparisonExpr | null {
    const left = this.parseExpression();
    if (!left) return null;

    const opTok = this.peek();
    const op = this.parseComparisonOperator();
    if (!op) {
      this.errorAt(opTok, ParseDiagnosticCode.INVALID_EXPRESSION,
        `Expected comparison operator (=, !=, <, >, <=, >=, IN, CONTAINS), got '${opTok.lexeme}'`);
      return null;
    }

    const right = this.parseExpression();
    if (!right) return null;

    return { kind: "Comparison", left, operator: op, right };
  }

  private parseComparisonOperator(): ComparisonExpr["operator"] | null {
    const map: Partial<Record<TokenType, ComparisonExpr["operator"]>> = {
      [TokenType.EQUAL]:         "=",
      [TokenType.NOT_EQUAL]:     "!=",
      [TokenType.LESS_THAN]:     "<",
      [TokenType.GREATER_THAN]:  ">",
      [TokenType.LESS_EQUAL]:    "<=",
      [TokenType.GREATER_EQUAL]: ">=",
      [TokenType.IN]:            "IN",
      [TokenType.CONTAINS]:      "CONTAINS",
    };
    const op = map[this.peek().type];
    if (op) { this.advance(); return op; }
    return null;
  }

  // -------------------------------------------------------------------------
  // EXISTS expression — §11, §18 EBNF
  //
  // EXISTS "(" Identifier ")"                        → variable form
  // EXISTS "(" Identifier "." Identifier ")"         → property form
  // EXISTS "(" NodePattern EdgePattern? NodePattern? ")" → path form
  // -------------------------------------------------------------------------

  private parseExistsExpr(): ExistsExprNode | null {
    this.advance(); // consume EXISTS
    if (!this.consume(TokenType.LEFT_PAREN, "Expected '(' after EXISTS")) return null;

    // Determine form by lookahead
    // If next token is IDENTIFIER and after that is DOT → property form
    // If next token is IDENTIFIER and after that is RIGHT_PAREN → variable form
    // If next token is LEFT_PAREN → path form  (node pattern)
    // If next token is COLON → path form (anonymous typed node)

    const tok = this.peek();
    const next2 = this.tokens[this.pos + 1];

    // Degenerate path: EXISTS((:Type)) — starts with LEFT_PAREN
    if (tok.type === TokenType.LEFT_PAREN || tok.type === TokenType.COLON) {
      return this.parseExistsPath();
    }

    if (tok.type === TokenType.IDENTIFIER) {
      // property form: EXISTS(var.prop)
      if (next2 && next2.type === TokenType.DOT) {
        const variable = this.advance().lexeme;
        this.advance(); // consume '.'
        const propTok = this.consume(TokenType.IDENTIFIER, "Expected property name after '.'");
        if (!propTok) return null;
        if (!this.consume(TokenType.RIGHT_PAREN, "Expected ')' to close EXISTS")) return null;
        return { kind: "ExistsExpr", form: "property", variable, propertyName: propTok.lexeme, path: null };
      }

      // variable form: EXISTS(var)
      if (next2 && next2.type === TokenType.RIGHT_PAREN) {
        const variable = this.advance().lexeme;
        this.advance(); // consume ')'
        return { kind: "ExistsExpr", form: "variable", variable, propertyName: null, path: null };
      }

      // Otherwise it's a path starting with a bound alias node: EXISTS((var) ...)
      // which actually starts with LEFT_PAREN — fall through won't reach here.
      // If we see IDENTIFIER without paren, it's invalid.
      this.errorAt(tok, ParseDiagnosticCode.INVALID_EXPRESSION,
        `EXISTS path must start with '(' or be a simple variable/property reference`);
      return null;
    }

    this.errorAt(tok, ParseDiagnosticCode.INVALID_EXPRESSION,
      `Unexpected token '${tok.lexeme}' inside EXISTS`);
    return null;
  }

  private parseExistsPath(): ExistsExprNode | null {
    // Parse full path inside EXISTS(...)
    const from = this.parseNodePattern();
    if (!from) return null;

    let edge: EdgePatternNode | null = null;
    let to: NodePatternNode | null = null;

    if (this.checkEdgeStart()) {
      edge = this.parseEdgePattern();
      if (!edge) return null;

      if (this.check(TokenType.LEFT_PAREN)) {
        to = this.parseNodePattern();
        if (!to) return null;
      }
    }

    if (!this.consume(TokenType.RIGHT_PAREN, "Expected ')' to close EXISTS path")) return null;

    const path: ExistsPathNode = { from, edge, to };
    return { kind: "ExistsExpr", form: "path", variable: null, propertyName: null, path };
  }

  // -------------------------------------------------------------------------
  // Expression — §18 EBNF
  //
  // Literal | PropertyAccess | FunctionCall | Identifier
  // -------------------------------------------------------------------------

  private parseExpression(): Expression | null {
    const tok = this.peek();

    // FunctionCall: COUNT, SUM, AVG, MIN, MAX, DEGREE
    const aggregateFuncs: TokenType[] = [
      TokenType.COUNT, TokenType.SUM, TokenType.AVG,
      TokenType.MIN, TokenType.MAX, TokenType.DEGREE,
    ];
    if (aggregateFuncs.includes(tok.type)) {
      return this.parseFunctionCall();
    }

    // Literal
    if (this.checkLiteralStart()) {
      const lit = this.parseLiteral();
      if (!lit) return null;
      const expr: LiteralExpr = { kind: "Literal", value: lit };
      return expr;
    }

    // PropertyAccess or Identifier
    if (this.check(TokenType.IDENTIFIER)) {
      const name = this.advance().lexeme;
      if (this.check(TokenType.DOT)) {
        this.advance(); // consume '.'
        const propTok = this.consume(TokenType.IDENTIFIER, "Expected property name after '.'");
        if (!propTok) return null;
        const expr: PropertyAccessExpr = { kind: "PropertyAccess", variable: name, property: propTok.lexeme };
        return expr;
      }
      const expr: IdentifierExpr = { kind: "Identifier", name };
      return expr;
    }

    this.errorAt(tok, ParseDiagnosticCode.INVALID_EXPRESSION,
      `Expected expression, got '${tok.lexeme}'`);
    return null;
  }

  // -------------------------------------------------------------------------
  // Function call — §18 FunctionCall
  //
  // AggregateFunc "(" Identifier ("." Identifier)? ")" ("BY" Identifier)?
  // "DEGREE" "(" Identifier ")"
  // -------------------------------------------------------------------------

  private parseFunctionCall(): FunctionCallNode | null {
    const nameTok = this.advance();
    const name = nameTok.lexeme as FunctionCallNode["name"];

    if (!this.consume(TokenType.LEFT_PAREN, `Expected '(' after ${name}`)) return null;

    const argTok = this.consume(TokenType.IDENTIFIER, `Expected variable name inside ${name}(...)`);
    if (!argTok) return null;
    const argument = argTok.lexeme;

    let property: string | null = null;
    if (this.check(TokenType.DOT)) {
      this.advance(); // consume '.'
      const propTok = this.consume(TokenType.IDENTIFIER, "Expected property name after '.'");
      if (!propTok) return null;
      property = propTok.lexeme;
    }

    if (!this.consume(TokenType.RIGHT_PAREN, `Expected ')' to close ${name}(...)`)) return null;

    let groupBy: string | null = null;
    if (name !== "DEGREE" && this.check(TokenType.BY)) {
      this.advance(); // consume BY
      const anchorTok = this.consume(TokenType.IDENTIFIER, "Expected anchor variable after BY");
      if (!anchorTok) return null;
      groupBy = anchorTok.lexeme;
    }

    return { kind: "FunctionCall", name, argument, property, groupBy };
  }

  // -------------------------------------------------------------------------
  // YIELD clause — §18 YieldClause
  //
  // YIELD StringLiteral (WITH IdentifierList)? ONCE?
  // -------------------------------------------------------------------------

  private parseYield(): YieldNode | null {
    const msgTok = this.consume(TokenType.STRING, "Expected YIELD message string");
    if (!msgTok) return null;
    const message = this.extractString(msgTok.lexeme);

    const withVars: string[] = [];
    if (this.check(TokenType.WITH)) {
      this.advance(); // consume WITH
      do {
        const varTok = this.consume(TokenType.IDENTIFIER, "Expected variable name in YIELD WITH list");
        if (!varTok) return null;
        withVars.push(varTok.lexeme);
      } while (this.match(TokenType.COMMA));
    }

    const once = this.match(TokenType.ONCE);

    return { kind: "Yield", message, withVars, once };
  }

  // -------------------------------------------------------------------------
  // Literals — §18
  // -------------------------------------------------------------------------

  private parseLiteral(): Literal | null {
    const tok = this.peek();

    if (this.check(TokenType.STRING)) {
      this.advance();
      const lit: StringLiteral = { kind: "string", value: this.extractString(tok.lexeme) };
      return lit;
    }

    if (this.check(TokenType.NUMBER)) {
      this.advance();
      const lit: NumberLiteral = { kind: "number", value: parseFloat(tok.lexeme) };
      return lit;
    }

    if (this.check(TokenType.BOOLEAN)) {
      this.advance();
      const lit: BooleanLiteral = { kind: "boolean", value: tok.lexeme === "true" || tok.lexeme === "TRUE" };
      return lit;
    }

    this.errorAt(tok, ParseDiagnosticCode.INVALID_EXPRESSION,
      `Expected literal (string, number, boolean), got '${tok.lexeme}'`);
    return null;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private checkEdgeStart(): boolean {
    return (
      this.check(TokenType.ARROW) ||
      this.check(TokenType.UNDIRECTED_EDGE) ||
      this.check(TokenType.DASH)
    );
  }

  private checkLiteralStart(): boolean {
    return (
      this.check(TokenType.STRING) ||
      this.check(TokenType.NUMBER) ||
      this.check(TokenType.BOOLEAN)
    );
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private previous(): Token {
    return this.tokens[this.pos - 1];
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.previous();
  }

  private check(type: TokenType): boolean {
    return !this.isAtEnd() && this.peek().type === type;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) { this.advance(); return true; }
    return false;
  }

  private consume(type: TokenType, message: string): Token | null {
    if (this.check(type)) return this.advance();
    this.errorAt(this.peek(), ParseDiagnosticCode.EXPECTED_TOKEN, message);
    return null;
  }

  /** Strips surrounding double-quotes from a string token lexeme */
  private extractString(lexeme: string): string {
    return lexeme.slice(1, -1);
  }

  private errorAt(tok: Token, code: ParseDiagnosticCode, message: string): void {
    this.diagnostics.push({ code, message, line: tok.line, column: tok.column });
  }

  /**
   * Error recovery — advance past tokens until we find the next RULE keyword
   * or EOF, so we can continue parsing subsequent rules.
   */
  private synchronise(): void {
    while (!this.isAtEnd()) {
      if (this.peek().type === TokenType.RULE) return;
      this.advance();
    }
  }
}
