import { Lexer } from "./lexer";

const sampleInput = `# Check for single points of failure
RULE "Single Server Behind Load Balancer"
SEVERITY ERROR

MATCH (lb:LoadBalancer) -> (srv:Server)
WHERE srv.instances < 2 AND srv.public = true
YIELD "Load balancer has fewer than 2 servers" WITH lb, srv ONCE
`;

console.log("Tokenizing sample input...\n");

const lexer = new Lexer(sampleInput);
const { tokens, diagnostics } = lexer.tokenize();

console.log("=== TOKENS ===");
tokens.forEach(token => {
    console.log(`Line ${token.line}, Col ${token.column} | ${token.type.padEnd(15)} | "${token.lexeme}"`);
});

console.log("\n=== DIAGNOSTICS ===");
if (diagnostics.length > 0) {
    diagnostics.forEach(diag => {
        console.error(`Line ${diag.line}, Col ${diag.column} | ${diag.code} | ${diag.message}`);
    });
} else {
    console.log("No lexer diagnostics/errors found! Lexer is working fine.");
}
