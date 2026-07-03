import { TokenType } from "./token";

/**
 * Multi-character operators should be matched first.
 */
// OPERATORS is an object mapping operator strings to their corresponding token types.
export const OPERATORS: Record<string, TokenType> = {
    "--": TokenType.UNDIRECTED_EDGE,
    "->": TokenType.ARROW,
    "-": TokenType.DASH,
    "*": TokenType.STAR,
    "..": TokenType.DOT_DOT,

    "!=": TokenType.NOT_EQUAL,

    "<=": TokenType.LESS_EQUAL,
    ">=": TokenType.GREATER_EQUAL,

    // NOTE: '=' is handled directly in the lexer scanToken() — not via OPERATORS table,
    // because the lexer must detect '==' (which is invalid ArchQL) and emit a diagnostic.
    "<":  TokenType.LESS_THAN,
    ">":  TokenType.GREATER_THAN,

    ":": TokenType.COLON,
    ",": TokenType.COMMA,
    ".": TokenType.DOT,

    "(": TokenType.LEFT_PAREN,
    ")": TokenType.RIGHT_PAREN,

    "{": TokenType.LEFT_BRACE,
    "}": TokenType.RIGHT_BRACE,

    "[": TokenType.LEFT_BRACKET,
    "]": TokenType.RIGHT_BRACKET,
};

/**
 * Operators sorted by descending length.
 * Useful for longest-match lexer behavior.
 */
export const SORTED_OPERATORS = Object.keys(OPERATORS).sort(
    (a, b) => b.length - a.length
);