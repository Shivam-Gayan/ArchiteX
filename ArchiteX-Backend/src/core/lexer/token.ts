/**
 * All token categories produced by the lexer.
 */
export enum TokenType {
    // Special
    EOF = "EOF",
    UNKNOWN = "UNKNOWN",

    // Literals
    IDENTIFIER = "IDENTIFIER",
    STRING = "STRING",
    NUMBER = "NUMBER",
    BOOLEAN = "BOOLEAN",

    // Keywords
    RULE = "RULE",
    SEVERITY = "SEVERITY",
    MATCH = "MATCH",
    OPTIONAL = "OPTIONAL",
    SIMULATE = "SIMULATE",
    WHERE = "WHERE",
    YIELD = "YIELD",
    ONCE = "ONCE",
    EXISTS = "EXISTS",

    // Operators / punctuation
    ASSIGN = "ASSIGN",             // =
    EQUAL = "EQUAL",               // ==
    NOT_EQUAL = "NOT_EQUAL",       // !=
    LESS_THAN = "LESS_THAN",       // <
    GREATER_THAN = "GREATER_THAN", // >
    LESS_EQUAL = "LESS_EQUAL",     // <=
    GREATER_EQUAL = "GREATER_EQUAL", // >=

    ARROW = "ARROW",               // ->
    RELATION_ARROW = "RELATION_ARROW", // -[:TYPE]->

    COLON = "COLON",
    COMMA = "COMMA",
    DOT = "DOT",
    SEMICOLON = "SEMICOLON",

    LEFT_PAREN = "LEFT_PAREN",
    RIGHT_PAREN = "RIGHT_PAREN",

    LEFT_BRACE = "LEFT_BRACE",
    RIGHT_BRACE = "RIGHT_BRACE",

    LEFT_BRACKET = "LEFT_BRACKET",
    RIGHT_BRACKET = "RIGHT_BRACKET",
}

/**
 * Represents a single token emitted by the lexer.
 */
export interface Token {
    type: TokenType;

    /**
     * Original text exactly as it appeared in source.
     */
    value: string;

    /**
     * 1-based line number.
     */
    line: number;

    /**
     * 1-based column number.
     */
    column: number;
}