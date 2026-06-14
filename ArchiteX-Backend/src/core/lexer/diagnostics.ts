/**
 * Types of lexical diagnostics.
 */
export enum LexerDiagnosticCode {
    UNEXPECTED_CHARACTER = "UNEXPECTED_CHARACTER",
    UNTERMINATED_STRING = "UNTERMINATED_STRING",
    INVALID_NUMBER = "INVALID_NUMBER",
    INVALID_ESCAPE_SEQUENCE = "INVALID_ESCAPE_SEQUENCE",
}

/**
 * Represents a lexer error or warning.
 */
export interface LexerDiagnostic {
    code: LexerDiagnosticCode;

    message: string;

    line: number;

    column: number;

    /**
     * Optional offending text.
     */
    lexeme?: string;
}

/**
 * Helper for creating diagnostics.
 */
export function createLexerDiagnostic(
    code: LexerDiagnosticCode,
    message: string,
    line: number,
    column: number,
    lexeme?: string
): LexerDiagnostic {
    return {
        code,
        message,
        line,
        column,
        lexeme,
    };
}
//Note it is equal to writing the following code
// return {
//     code: code,
//     message: message,
//     line: line,
//     column: column,
//     lexeme: lexeme,
// };