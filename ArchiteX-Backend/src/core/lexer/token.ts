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


    //Error functions
    ERROR = "ERROR",
    WARNING = "WARNING",
    INFO = "INFO",
    HINT = "HINT",

    //Aggregation functions
    COUNT = "COUNT",
    SUM = "SUM",
    AVG = "AVG",
    MAX = "MAX",
    MIN = "MIN",
    DEGREE = "DEGREE",

    // Operators / punctuation
    ASSIGN = "ASSIGN",             // =
    EQUAL = "EQUAL",               // ==
    NOT_EQUAL = "NOT_EQUAL",       // !=
    LESS_THAN = "LESS_THAN",       // <
    GREATER_THAN = "GREATER_THAN", // >
    LESS_EQUAL = "LESS_EQUAL",     // <=
    GREATER_EQUAL = "GREATER_EQUAL", // >=
    NOT = "NOT",
    AND = "AND",
    OR = "OR",
    IN = "IN",
    CONTAINS = "CONTAINS",
    WITH = "WITH",
    BY = "BY",


    ARROW = "ARROW",               // ->
    DASH = "DASH",                     // -  (standalone dash)(start of -[ )
    UNDIRECTED_EDGE = "UNDIRECTED_EDGE", // --
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