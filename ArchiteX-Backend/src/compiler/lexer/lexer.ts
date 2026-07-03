import { Token, TokenType } from "./token";
import { KEYWORDS } from "./keywords";
import { LexerDiagnostic, LexerDiagnosticCode } from "./diagnostics";

// TokenType → tells us what kind of token it is.
// Token → object structure.
// KEYWORDS → map for recognizing RULE, MATCH, etc.
// LexerDiagnostic → error reporting.  

export class Lexer {
    private tokens: Token[] = [];
    private diagnostics: LexerDiagnostic[] = [];

    private start = 0;
    private current = 0;

    private line = 1;
    private column = 1;

    private startLine = 1;
    private startColumn = 1;

    constructor(private source: string) { }

    //Main entry point.
    public tokenize() {
        while (!this.isAtEnd()) {
            this.skipWhitespace();
            if (this.isAtEnd()) break;

            this.start = this.current;
            this.startLine = this.line;
            this.startColumn = this.column;
            this.scanToken();
        }

        this.start = this.current;
        this.startLine = this.line;
        this.startColumn = this.column;
        this.addToken(TokenType.EOF);

        return {
            tokens: this.tokens,
            diagnostics: this.diagnostics,
        };
    }

    //Checks if we have reached the end of the source string.
    private isAtEnd(): boolean {
        return this.current >= this.source.length;
    }

    //Current character consumed and returned.
    private advance(): string {
        const ch = this.source[this.current];

        this.current++;
        this.column++;

        return ch;
    }

    //Looks at the current character without consuming it.
    private peek(): string {
        if (this.isAtEnd()) return '\0';

        return this.source[this.current];
    }

    private peekNext(): string {
        if (this.current + 1 >= this.source.length)
            return '\0';

        return this.source[this.current + 1];
    }

    //match the current character with the expected character. If they match, consume it and return true. Otherwise, return false.
    private match(expected: string): boolean {
        if (this.isAtEnd()) return false;

        if (this.source[this.current] !== expected)
            return false;

        this.current++;
        this.column++;

        return true;
    }

    private skipWhitespace() {
        while (!this.isAtEnd()) {
            const c = this.peek();
            switch (c) {
                case ' ':
                case '\r':
                case '\t':
                    this.advance();
                    break;
                case '\n':
                    this.advance();
                    this.line++;
                    this.column = 1;
                    break;
                case '#':
                    // Comments go to the end of the line
                    this.advance(); // consume '#'
                    while (this.peek() !== '\n' && !this.isAtEnd()) {
                        this.advance();
                    }
                    break;
                default:
                    return;
            }
        }
    }

    private addToken(type: TokenType) {
        const text = this.source.substring(
            this.start,
            this.current
        );

        this.tokens.push({
            type,
            lexeme: text,
            line: this.startLine,
            column: this.startColumn,
        });
    }

    private isDigit(char: string): boolean {
        return char >= "0" && char <= "9";
    }

    private isAlpha(char: string): boolean {
        return (char >= "a" && char <= "z") ||
            (char >= "A" && char <= "Z") ||
            (char === "_");
    }

    private number() {
        while (this.isDigit(this.peek()))
            this.advance();

        // Handle floating point
        if (this.peek() === '.' && this.isDigit(this.peekNext())) {
            this.advance(); // consume '.'
            while (this.isDigit(this.peek()))
                this.advance();
        }

        this.addToken(TokenType.NUMBER);
    }

    private identifier() {
        while (this.isAlpha(this.peek()) || this.isDigit(this.peek()))
            this.advance();

        const text = this.source.substring(this.start, this.current);
        const type = KEYWORDS[text] ?? TokenType.IDENTIFIER;

        this.addToken(type);
    }

    private string() {
        while (this.peek() !== '"' && !this.isAtEnd()) {
            if (this.peek() === '\n') {
                this.line++;
                this.column = 1;
            }
            this.advance();
        }
        if (this.isAtEnd()) {
            this.diagnostics.push({
                code: LexerDiagnosticCode.UNTERMINATED_STRING,
                message: "Unterminated string literal.",
                line: this.startLine,
                column: this.startColumn
            });
            return;
        }
        // Consume closing quote
        this.advance();
        this.addToken(TokenType.STRING);
    }
    private error(message: string) {
        this.diagnostics.push({
            code: LexerDiagnosticCode.UNEXPECTED_CHARACTER,
            message,
            line: this.startLine,
            column: this.startColumn
        });
    }

    private scanToken() {
        const c = this.advance();

        switch (c) {
            case '(':
                this.addToken(TokenType.LEFT_PAREN);
                break;

            case ')':
                this.addToken(TokenType.RIGHT_PAREN);
                break;

            case '{':
                this.addToken(TokenType.LEFT_BRACE);
                break;

            case '}':
                this.addToken(TokenType.RIGHT_BRACE);
                break;

            case '[':
                this.addToken(TokenType.LEFT_BRACKET);
                break;

            case ']':
                this.addToken(TokenType.RIGHT_BRACKET);
                break;

            case ':':
                this.addToken(TokenType.COLON);
                break;

            case '"':
                this.string();
                break;

            case ',':
                this.addToken(TokenType.COMMA);
                break;

            case ';':
                this.addToken(TokenType.SEMICOLON);
                break;

            case '=':
                // ArchQL §18: '=' is the equality operator. '==' is not valid.
                if (this.match("=")) {
                    this.error("'==' is not valid ArchQL. Use '=' for equality comparisons.");
                } else {
                    this.addToken(TokenType.EQUAL);
                }
                break;

            case '!':
                this.addToken(
                    this.match("=")
                        ? TokenType.NOT_EQUAL
                        : TokenType.NOT
                );
                break;

            case '<':
                this.addToken(
                    this.match("=")
                        ? TokenType.LESS_EQUAL
                        : TokenType.LESS_THAN
                );
                break;

            case '>':
                this.addToken(
                    this.match("=")
                        ? TokenType.GREATER_EQUAL
                        : TokenType.GREATER_THAN
                );
                break;

            case '-':
                if (this.match(">")) {
                    this.addToken(TokenType.ARROW);
                } else if (this.match("-")) {
                    this.addToken(TokenType.UNDIRECTED_EDGE);
                } else {
                    this.addToken(TokenType.DASH);
                }
                break;

            case '*':
                this.addToken(TokenType.STAR);
                break;

            case '.':
                if (this.match(".")) {
                    this.addToken(TokenType.DOT_DOT);
                } else {
                    this.addToken(TokenType.DOT);
                }
                break;

            default:
                if (this.isDigit(c)) {
                    this.number();
                }
                else if (this.isAlpha(c)) {
                    this.identifier();
                }
                else {
                    this.error(`Unexpected character ${c}`);
                }
        }

    }
}
