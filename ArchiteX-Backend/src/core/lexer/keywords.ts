import { TokenType } from "./token";

/**
 * Reserved keywords of the language.
 */
export const KEYWORDS: Record<string, TokenType> = {
    RULE: TokenType.RULE,
    SEVERITY: TokenType.SEVERITY,
    MATCH: TokenType.MATCH,
    OPTIONAL: TokenType.OPTIONAL,
    SIMULATE: TokenType.SIMULATE,
    WHERE: TokenType.WHERE,
    YIELD: TokenType.YIELD,
    ONCE: TokenType.ONCE,
    EXISTS: TokenType.EXISTS,

    // Boolean literals
    TRUE: TokenType.BOOLEAN,
    FALSE: TokenType.BOOLEAN,
};

/**
 * Determines whether an identifier is reserved. See it is case-insensitive.
 */
export function isKeyword(value: string): boolean {
    return value.toUpperCase() in KEYWORDS;
}

/**
 * Returns the token type associated with a keyword else undefined
 */
export function getKeywordTokenType(
    value: string
): TokenType | undefined {
    return KEYWORDS[value.toUpperCase()];
}