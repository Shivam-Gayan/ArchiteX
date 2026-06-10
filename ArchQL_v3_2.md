# ArchQL v3 — Language Specification

**Project:** ArchiteX — Smart System Canvas\
**Purpose:** Architecture Validation DSL\
**Revision:** v3.2 — Final

---

# 1. Overview

ArchQL is a **domain-specific language (DSL)** designed to validate
**software architecture diagrams**.

Architectures are represented internally as a **property graph**.

Graph elements:

- **Nodes** → infrastructure components
- **Edges** → communication links
- **Properties** → key-value metadata attached to nodes or edges

ArchQL rules detect:

- Security vulnerabilities
- Scalability bottlenecks
- Misconfigurations
- Missing architecture components
- Anti-patterns

---

# 2. Architecture Graph Model

## Nodes

Nodes represent infrastructure components in a distributed system.

Example:

```
(api:Server {instances:3, region:"us-east"})
```

### Supported Node Types

| Type | Description |
|------|-------------|
| `Client` | End-user or external caller |
| `APIGateway` | API gateway / reverse proxy entry point |
| `LoadBalancer` | Traffic distribution layer |
| `Server` | Application or service instance |
| `Worker` | Background processing unit |
| `Queue` | Message queue (e.g. SQS, RabbitMQ) |
| `MessageBroker` | Pub/sub broker (e.g. Kafka, RabbitMQ) |
| `StreamProcessor` | Stream computation (e.g. Flink, Spark) |
| `Cache` | In-memory cache (e.g. Redis, Memcached) |
| `Database` | Persistent data store |
| `SearchEngine` | Full-text search (e.g. Elasticsearch) |
| `ObjectStorage` | Blob/file storage (e.g. S3) |
| `CDN` | Content delivery network |
| `AuthService` | Authentication / authorization service |
| `RateLimiter` | Request rate control layer |
| `CircuitBreaker` | Fault isolation proxy |
| `ServiceMesh` | Service-to-service networking layer |
| `Monitoring` | Metrics collection (e.g. Prometheus, Datadog) |
| `Logging` | Log aggregation (e.g. ELK stack) |
| `Tracing` | Distributed tracing (e.g. Jaeger, Zipkin) |

> **Type names are case-sensitive.** `Server` is valid; `server` and `SERVER` are not.

---

# 3. Properties

Properties are key-value metadata attached to nodes or edges.

```
(srv:Server {instances:3, cpu:70})
```

Property names are **open** — any key-value pair may be attached to any node or edge. The tables below document the standard conventions used by the built-in rule set.

### Standard Node Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Component name |
| `region` | string | Deployment region (e.g. `"us-east"`) |
| `zone` | string | Availability zone |
| `instances` | number | Replica count |
| `cpu` | number | CPU utilization % |
| `memory` | number | Memory utilization % |
| `capacity` | number | Max throughput (req/s) |
| `public` | boolean | Exposed to the internet |
| `encrypted` | boolean | Data encrypted in transit |
| `version` | string | Component version tag |

### Standard Edge Properties

| Property | Type | Description |
|----------|------|-------------|
| `protocol` | string | Transport protocol (`"HTTP"`, `"gRPC"`, `"AMQP"`, …) |
| `encrypted` | boolean | Connection uses TLS |
| `latency` | number | Expected latency in ms |
| `rateLimit` | number | Max req/s on this link |
| `timeout` | number | Timeout in ms |
| `retries` | number | Retry count |

---

# 4. Edge Types

Edges represent communication or data flow between nodes.

| Type | Description |
|------|-------------|
| `Traffic` | Generic HTTP / TCP traffic |
| `Reads` | Data read operation |
| `Writes` | Data write operation |
| `Calls` | Synchronous RPC / API call |
| `ReplicatesTo` | Data replication link |
| `Publishes` | Message publication |
| `Consumes` | Message consumption |
| `Streams` | Streaming data flow |
| `Proxies` | Traffic proxying (ServiceMesh, CircuitBreaker) |

Examples:

```
(api) -[:Calls]-> (auth:AuthService)
(api) -[:Calls {encrypted:false}]-> (db:Database)
```

---

# 5. Rule Structure

```
# Comment — ignored by parser
RULE      "<name>"
SEVERITY  <level>

MATCH     <pattern>
[OPTIONAL <pattern>]*
[SIMULATE <var> = <value> [, <var> = <value>]*]
[WHERE    <condition>]
YIELD     "<message>" [WITH <var> [, <var>]*] [ONCE]
```

**Clause ordering is mandatory.** `SIMULATE` must appear before `WHERE` because the WHERE expression evaluates SIMULATE variables. The parser will reject any rule where this ordering is violated.

Only `MATCH`, `SEVERITY`, `RULE`, and `YIELD` are required. `OPTIONAL`, `SIMULATE`, and `WHERE` are optional.

---

# 6. Comments

Lines beginning with `#` are comments and are ignored entirely by the lexer.

```
# This rule checks for single points of failure
RULE "Single Server Behind Load Balancer"
SEVERITY ERROR
```

**Inline (end-of-line) comments are not supported.** A `#` character in the middle of a line will cause a lexer error.

---

# 7. Severity Levels

| Token | Meaning |
|-------|---------|
| `ERROR` | Architecture is broken or critically unsafe. Must fix. |
| `WARNING` | Strong best-practice violation. Should fix. |
| `INFO` | Informational observation. May fix. |
| `HINT` | Optimization suggestion. Nice to fix. |

---

# 8. Quantifier Semantics

ArchQL evaluates rules **per match row by default**.

Every matched subgraph that satisfies the `WHERE` clause produces one violation.

Example — three servers each behind their own load balancer, all with `instances < 2`:

```
MATCH (lb:LoadBalancer) -> (srv:Server)
WHERE srv.instances < 2
```

This produces **three separate violations**, one per matched `(lb, srv)` pair.

### YIELD ONCE

`YIELD ONCE` emits **at most one violation per rule**, regardless of how many match rows violate the condition. Use it for global checks where per-match noise is not useful.

```
YIELD "No monitoring configured" ONCE
```

---

# 9. Simulation Variables

Simulation allows rules to test hypothetical architecture scenarios using injected or defaulted numeric values.

### In-rule defaults (declared before WHERE)

```
SIMULATE traffic = 10000, latency = 200
```

### Frontend injection contract

```json
{
  "simulation": {
    "traffic": 15000,
    "latency": 200
  }
}
```

### Resolution order

| Case | Behavior |
|------|----------|
| Variable provided by frontend | Frontend value is used |
| Variable defined only in SIMULATE | Rule default is used |
| Variable missing from both | Rule is skipped; a diagnostic is emitted |

---

# 10. Aggregation Functions

ArchQL provides two kinds of aggregation: **global** (across all match rows) and **grouped** (per anchor variable).

### Global aggregation

```
COUNT(var)
```

Accumulates across **all match rows** in the rule. Used when you want to know the total count of a node type in the graph.

Example — flag if fewer than 2 databases exist globally:

```
MATCH (db:Database)
WHERE COUNT(db) < 2
YIELD "Fewer than 2 databases — no redundancy" ONCE
```

### Grouped aggregation — `BY`

```
COUNT(var) BY anchor
```

Groups match rows by the distinct identity of `anchor`, then evaluates the condition **independently per group**. One violation is produced per group that fails the condition.

**This is the correct form for checking per-component constraints.**

Example — flag each load balancer that has fewer than 2 servers:

```
MATCH (lb:LoadBalancer) -> (srv:Server)
WHERE COUNT(srv) BY lb < 2
YIELD "Load balancer has fewer than 2 servers — SPOF" WITH lb, srv
```

Consider this graph:

```
lb1 → srv1
lb1 → srv2
lb2 → srv3
```

- Group `lb1`: COUNT(srv) = 2 → condition false → no violation
- Group `lb2`: COUNT(srv) = 1 → condition true → violation fires

Without `BY lb`, `COUNT(srv)` = 3 globally, condition is false, and `lb2` is silently missed. **Always use `BY` when the constraint is per-component.**

### `BY` applies to all aggregate functions

| Function | Description |
|----------|-------------|
| `COUNT(var) [BY anchor]` | Number of distinct matched nodes |
| `SUM(var.prop) [BY anchor]` | Sum of a numeric property |
| `AVG(var.prop) [BY anchor]` | Average of a numeric property |
| `MIN(var.prop) [BY anchor]` | Minimum of a numeric property |
| `MAX(var.prop) [BY anchor]` | Maximum of a numeric property |

The `anchor` must be a variable already bound in the `MATCH` clause.

### DEGREE

```
DEGREE(var)
```

Returns the number of **direct outbound edges** from a node, regardless of type. Operates per match row — no `BY` needed.

```
MATCH (srv:Server)
WHERE DEGREE(srv) > 8
YIELD "Service has too many outbound connections" WITH srv
```

`DEGREE` is distinct from `COUNT`: COUNT measures matched variables across rows; DEGREE measures raw connectivity of a single node.

---

# 11. EXISTS Function

`EXISTS` checks the presence of a node, a property, or a path. It returns a boolean and is used inside `WHERE`.

### Form 1 — Bound variable existence

```
EXISTS(auth)
```

Returns `true` if the variable `auth` is not null. Used with `OPTIONAL` to test whether an optional pattern matched.

### Form 2 — Property existence

```
EXISTS(srv.cpu)
```

Returns `true` if property `cpu` is defined on node `srv`.

### Form 3 — Path existence

```
EXISTS(NodePattern EdgePattern NodePattern)
EXISTS(NodePattern EdgePattern)
EXISTS(NodePattern)
```

Returns `true` if a matching path or node is found in the graph.

The NodePattern on either side can be:
- An anonymous typed node: `(:Cache)` — matches any node of that type
- A bound alias: `(srv)` — anchors the search to a specific already-matched node
- A typed bound alias: `(srv:Server)` — requires the bound node to also be of that type

**Degenerate form (type-existence check):**

```
EXISTS((:Tracing))
```

Returns `true` if any node of type `Tracing` exists anywhere in the graph. No edge is required.

**Anchored path check:**

```
EXISTS((srv) -[:Reads*1..2]-> (:Cache))
```

Returns `true` if there exists any `Cache` reachable from this specific `srv` within 1–2 `Reads` hops.

**Anonymous-to-bound check:**

```
EXISTS((:LoadBalancer) -> (srv))
```

Returns `true` if any `LoadBalancer` has an edge pointing to this specific `srv`.

### EXISTS and OPTIONAL

When a variable is introduced via `OPTIONAL`, it is `null` if the optional pattern did not match. `EXISTS(var)` returns `false` for a null variable. This is the standard idiom for detecting absent components:

```
MATCH (api:APIGateway)
OPTIONAL (api) -> (auth:AuthService)
WHERE NOT EXISTS(auth)
YIELD "API Gateway has no authentication service" WITH api
```

---

# 12. Pattern Matching

Patterns define graph substructures to search for.

```
(client:Client) -> (api:APIGateway) -> (srv:Server)
```

---

# 13. Node Patterns

| Form | Meaning |
|------|---------|
| `(alias:Type)` | Bind alias to any node of that type |
| `(:Type)` | Match any node of that type (no alias) |
| `(alias)` | Bind alias to any node of any type |
| `()` | Wildcard — match any node, bind nothing |
| `(:Type {prop:val})` | Typed node with property filter |

---

# 14. Edge Patterns

| Syntax | Meaning |
|--------|---------|
| `->` | Any directed edge |
| `-[:Type]->` | Directed edge of specific type |
| `-[alias:Type]->` | Directed edge, bound to alias |
| `-[alias:Type {prop:val}]->` | Directed edge with property filter |
| `--` | Undirected edge |

---

# 15. Optional Patterns

`OPTIONAL` extends a match with additional graph structure that may or may not be present.

```
MATCH (api:APIGateway)
OPTIONAL (api) -> (auth:AuthService)
WHERE NOT EXISTS(auth)
YIELD "API Gateway has no authentication service" WITH api
```

### Binding rules

- Variables bound in `MATCH` may be referenced freely in `OPTIONAL`.
- Variables introduced **only** in `OPTIONAL` are `null` when the optional pattern is absent.
- Multiple `OPTIONAL` clauses are allowed. Each is evaluated independently.
- `EXISTS(var)` on an OPTIONAL-introduced variable returns `false` when null.

---

# 16. Path Traversal

ArchQL supports variable-length path matching within edge patterns.

```
(client) -[:Calls*1..5]-> (db:Database)
```

| Syntax | Meaning |
|--------|---------|
| `*1..5` | Between 1 and 5 hops (inclusive) |
| `*3` | Exactly 3 hops |
| `*` | Any number of hops |

The unbounded form `*` uses a **default maximum depth of 10 hops**. Implementors must enforce this cap to prevent runaway traversal. The cap may be overridden via a runtime configuration flag.

---

# 17. Comparison Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `=` | Equals | `region = "us-east"` |
| `!=` | Not equals | `region != "us-east"` |
| `<` | Less than | `instances < 2` |
| `>` | Greater than | `cpu > 80` |
| `<=` | Less than or equal | `instances <= 1` |
| `>=` | Greater than or equal | `capacity >= 1000` |
| `IN` | Value is in a list | `region IN ["us-east", "us-west"]` |
| `CONTAINS` | String contains substring | `name CONTAINS "prod"` |

---

# 18. Grammar (EBNF)

```ebnf
File
   → (Comment | Rule)+

Comment
   → "#" [^\n]* "\n"

Rule
   → Definition MatchClause OptionalClause* SimulateClause? WhereClause? YieldClause

Definition
   → "RULE" StringLiteral
     "SEVERITY" SeverityLevel

SeverityLevel
   → "ERROR" | "WARNING" | "INFO" | "HINT"

MatchClause
   → "MATCH" Pattern

OptionalClause
   → "OPTIONAL" Pattern

SimulateClause
   → "SIMULATE" SimulateBinding ("," SimulateBinding)*

SimulateBinding
   → Identifier "=" Literal

WhereClause
   → "WHERE" BooleanExpr

Pattern
   → NodePattern (EdgePattern NodePattern)*

NodePattern
   → "(" Alias ":" Type PropertyMap? ")"
   | "(" ":" Type PropertyMap? ")"
   | "(" Alias PropertyMap? ")"
   | "(" ")"

EdgePattern
   → "-[" Alias? ":" Type PathDepth? PropertyMap? "]->"
   | "->"
   | "--"

PathDepth
   → "*" NumberLiteral ".." NumberLiteral
   | "*" NumberLiteral
   | "*"

PropertyMap
   → "{" Property ("," Property)* "}"

Property
   → Identifier ":" Literal

(* Precedence: NOT binds tightest, then AND, then OR *)
BooleanExpr
   → BooleanTerm ("OR" BooleanTerm)*

BooleanTerm
   → BooleanFactor ("AND" BooleanFactor)*

BooleanFactor
   → "NOT" BooleanFactor
   | Comparison
   | "(" BooleanExpr ")"

Comparison
   → Expression Operator Expression
   | ExistsExpr

ExistsExpr
   → "EXISTS" "(" Identifier ")"
   | "EXISTS" "(" Identifier "." Identifier ")"
   | "EXISTS" "(" NodePattern EdgePattern NodePattern ")"
   | "EXISTS" "(" NodePattern EdgePattern ")"
   | "EXISTS" "(" NodePattern ")"

Operator
   → "=" | "!=" | "<" | ">" | "<=" | ">=" | "IN" | "CONTAINS"

Expression
   → Literal
   | PropertyAccess
   | FunctionCall
   | Identifier

PropertyAccess
   → Identifier "." Identifier

FunctionCall
   → AggregateFunc "(" Identifier ("." Identifier)? ")" ("BY" Identifier)?
   | "DEGREE" "(" Identifier ")"

AggregateFunc
   → "COUNT" | "SUM" | "AVG" | "MIN" | "MAX"

YieldClause
   → "YIELD" StringLiteral ("WITH" IdentifierList)? "ONCE"?

IdentifierList
   → Identifier ("," Identifier)*

Literal
   → StringLiteral
   | NumberLiteral
   | BooleanLiteral
   | ListLiteral

StringLiteral  → '"' [^"]* '"'
NumberLiteral  → [0-9]+ ("." [0-9]+)?
BooleanLiteral → "true" | "false"
ListLiteral    → "[" Literal ("," Literal)* "]"

Alias          → Identifier
Type           → Identifier
Identifier     → [a-zA-Z_][a-zA-Z0-9_]*
```

---

# 19. AST Design

```
RuleNode
  ├── name              : string
  ├── severity          : SeverityLevel
  ├── matchClause       : PatternNode
  ├── optionalClauses   : PatternNode[]
  ├── simulateBindings  : SimulateBinding[]
  ├── whereClause       : BooleanExpr | null
  └── yieldClause       : YieldNode

YieldNode
  ├── message           : string
  ├── withVars          : string[]
  └── once              : boolean

PatternNode
  └── elements          : (NodePatternNode | EdgePatternNode)[]

NodePatternNode
  ├── alias             : string | null
  ├── type              : string | null
  └── properties        : Map<string, Literal>

EdgePatternNode
  ├── alias             : string | null
  ├── type              : string | null
  ├── direction         : "directed" | "undirected"
  ├── depth             : PathDepthNode | null
  └── properties        : Map<string, Literal>

PathDepthNode
  ├── min               : number                  (default: 1)
  └── max               : number | null           (null = engine default cap: 10)

ExistsExprNode
  ├── form              : "variable" | "property" | "path"
  └── path              : ExistsPathNode | null

ExistsPathNode
  ├── from              : NodePatternNode
  ├── edge              : EdgePatternNode | null
  └── to                : NodePatternNode | null

FunctionCallNode
  ├── name              : "COUNT" | "SUM" | "AVG" | "MIN" | "MAX" | "DEGREE"
  ├── argument          : string                  (bound variable name)
  ├── property          : string | null           (for SUM/AVG/MIN/MAX on var.prop)
  └── groupBy           : string | null           (BY anchor variable, null = global)

SimulateBinding
  ├── variable          : string
  └── value             : Literal
```

---

# 20. Semantic Analysis Rules

The semantic analyzer validates the AST before graph matching. All checks below must pass or the rule is rejected with an error.

| Check | Error |
|-------|-------|
| All variables in WHERE are bound in MATCH or OPTIONAL | `Unbound variable '{x}' in WHERE clause` |
| All variables in YIELD WITH are bound in MATCH or OPTIONAL | `Unbound variable '{x}' in YIELD WITH` |
| The BY anchor in an aggregate must be bound in MATCH | `BY anchor '{x}' must be bound in MATCH, not OPTIONAL` |
| DEGREE argument must be a bound alias | `DEGREE argument must be a bound variable` |
| EXISTS path endpoints that are aliases must be bound | `EXISTS path endpoint '{x}' is not a bound variable` |
| SIMULATE variable names must not shadow node aliases | `SIMULATE variable '{x}' conflicts with bound alias` |
| Rule names must be unique across all loaded .arch files | `Duplicate rule name: '{x}'` |
| SUM / AVG / MIN / MAX must be applied to a numeric property | `Aggregate function requires a property accessor: SUM(var.prop)` |

**Binding scope rule for BY:** The `BY` anchor must be bound in `MATCH` specifically, not `OPTIONAL`. An OPTIONAL variable can be null, which would make grouping undefined.

---

# 21. Rule Engine Pipeline

```
.arch file(s)
      │
      ▼
   Lexer
   Tokenises keywords, identifiers, literals.
   Strips comment lines. Emits token stream.
      │
      ▼
   Parser
   Builds AST from token stream per §18 grammar.
   Enforces mandatory clause ordering.
      │
      ▼
   Semantic Analyzer
   ├─ Resolves and validates all variable bindings
   ├─ Resolves SIMULATE values (frontend overrides → rule defaults)
   ├─ Type-checks expressions
   └─ Enforces all checks from §20
      │
      ▼
   Graph Pattern Matcher
   ├─ Binds MATCH patterns across the property graph
   ├─ Extends bindings with OPTIONAL patterns (null when absent)
   └─ Traverses variable-length paths (capped at 10 hops by default)
      │
      ▼
   Rule Evaluator
   ├─ Evaluates WHERE per match row
   ├─ Applies BY grouping for aggregate functions
   ├─ Computes DEGREE per node per match row
   ├─ Applies YIELD ONCE deduplication where flagged
   └─ Collects all violations
      │
      ▼
   Diagnostics Payload
   Serialises violations as JSON array → frontend
```

---

# 22. Frontend Diagnostics Payload

Each violation produces one JSON object. The engine returns an array.

```json
[
  {
    "ruleName": "string",
    "severity": "ERROR | WARNING | INFO | HINT",
    "message": "string",
    "highlightedNodeIds": ["string"],
    "ruleFile": "string"
  }
]
```

| Field | Type | Description |
|-------|------|-------------|
| `ruleName` | string | The RULE name string |
| `severity` | string | The SEVERITY level |
| `message` | string | The YIELD message |
| `highlightedNodeIds` | string[] | IDs of nodes in YIELD WITH — canvas draws red borders on these |
| `ruleFile` | string | The .arch filename the rule came from |

### Example

```json
[
  {
    "ruleName": "Single Server Behind Load Balancer",
    "severity": "ERROR",
    "message": "Load balancer has fewer than 2 servers — SPOF",
    "highlightedNodeIds": ["node_lb_2", "node_srv_3"],
    "ruleFile": "availability_rules.arch"
  }
]
```

---

# 23. File Format

ArchQL rule files use the `.arch` extension.

```
security_rules.arch
availability_rules.arch
performance_rules.arch
scalability_rules.arch
```

Multiple files may be loaded together. Rule names must be **globally unique** across all loaded files — a duplicate causes the engine to halt with an error before any evaluation begins.

---

# 24. Anti-Pattern Rule Library

## Fully Detectable (18 patterns)

---

### 1. Single Point of Failure (SPOF)

```
RULE "Single Server Behind Load Balancer"
SEVERITY ERROR

MATCH (lb:LoadBalancer) -> (srv:Server)

WHERE COUNT(srv) BY lb < 2

YIELD "Load balancer has fewer than 2 servers — single point of failure" WITH lb, srv
```

`BY lb` ensures each load balancer is evaluated independently. A load balancer with 2+ servers does not suppress a violation for a sibling that has only 1.

---

### 2. Direct Client-to-Database Access

```
RULE "Client Directly Accesses Database"
SEVERITY ERROR

MATCH (c:Client) -> (db:Database)

YIELD "Client is directly connected to a database — bypasses all security layers" WITH c, db
```

---

### 3. Missing Cache Before Database

```
RULE "No Cache Before Database"
SEVERITY WARNING

MATCH (srv:Server) -> (db:Database)

WHERE NOT EXISTS((srv) -[:Reads*1..2]-> (:Cache))

YIELD "Server reads database without a cache layer — high DB load risk" WITH srv, db
```

---

### 4. API Gateway Without Authentication

```
RULE "Unauthenticated API Gateway"
SEVERITY ERROR

MATCH (api:APIGateway)

OPTIONAL (api) -> (auth:AuthService)

WHERE NOT EXISTS(auth)

YIELD "API Gateway has no authentication service" WITH api
```

`NOT EXISTS(auth)` tests the bound variable from OPTIONAL — it correctly checks whether *this specific gateway* has an auth service, not whether any auth service exists globally.

---

### 5. Server Exposed Without Load Balancer

```
RULE "Server Directly Reachable by Client"
SEVERITY WARNING

MATCH (c:Client) -> (srv:Server)

WHERE NOT EXISTS((:LoadBalancer) -> (srv))

YIELD "Server is directly reachable by client with no load balancer" WITH srv
```

The anonymous typed node `(:LoadBalancer)` on the left means "any load balancer." The bound alias `(srv)` on the right anchors the check to this specific server.

---

### 6. Publicly Exposed Database

```
RULE "Database Exposed to Internet"
SEVERITY ERROR

MATCH (db:Database {public:true})

YIELD "Database is publicly accessible — critical security risk" WITH db
```

---

### 7. No Monitoring on Server

```
RULE "No Monitoring Configured"
SEVERITY WARNING

MATCH (srv:Server)

OPTIONAL (srv) -> (mon:Monitoring)

WHERE NOT EXISTS(mon)

YIELD "Server has no monitoring attached" WITH srv
```

Remove `ONCE` here — you want one violation per unmonitored server, not a single global warning that hides how many are affected.

---

### 8. No Distributed Tracing

```
RULE "No Distributed Tracing in Architecture"
SEVERITY INFO

MATCH (srv:Server)

OPTIONAL (srv) -> (t:Tracing)

WHERE NOT EXISTS(t)

YIELD "No distributed tracing connected to any service" ONCE
```

`ONCE` is correct here — this is a global architectural observation, not a per-server finding.

---

### 9. Single-Region Deployment

```
RULE "Single Region Deployment"
SEVERITY WARNING

MATCH (db:Database)

SIMULATE minDatabases = 2

WHERE COUNT(db) < minDatabases

YIELD "Fewer than the recommended number of databases detected — possible single-region deployment" ONCE
```

Global `COUNT(db)` without `BY` is correct here — we want the total count of all databases in the graph. `ONCE` because this is a global architectural observation.

---

### 10. Unencrypted Connection to Database

```
RULE "Unencrypted Database Connection"
SEVERITY ERROR

MATCH (srv:Server) -[conn:Writes {encrypted:false}]-> (db:Database)

YIELD "Database write connection is not encrypted" WITH srv, db
```

---

### 11. No Rate Limiting on Public API

```
RULE "Public API Without Rate Limiter"
SEVERITY WARNING

MATCH (api:APIGateway)

OPTIONAL (api) -> (rl:RateLimiter)

WHERE NOT EXISTS(rl)

YIELD "API Gateway has no rate limiter — vulnerable to abuse and DDoS" WITH api ONCE
```

---

### 12. No Circuit Breaker on Service-to-Service Calls

```
RULE "Missing Circuit Breaker"
SEVERITY WARNING

MATCH (a:Server) -> (b:Server)

WHERE NOT EXISTS((a) -> (:CircuitBreaker) -> (b))

YIELD "Service calls another service without a circuit breaker — cascading failure risk" WITH a, b
```

---

### 13. God Service (Too Many Responsibilities)

```
RULE "God Service Anti-Pattern"
SEVERITY WARNING

MATCH (srv:Server)

WHERE DEGREE(srv) > 8

YIELD "Service has too many outbound connections — likely a God Service" WITH srv
```

`DEGREE` counts raw outbound edges from the node, not matched variables — correct for this use case.

---

### 14. Deep Synchronous Call Chain

```
RULE "Synchronous Call Chain Too Deep"
SEVERITY WARNING

MATCH (c:Client) -[:Calls*6..20]-> (db:Database)

YIELD "Request reaches database through 6+ synchronous hops — latency and failure risk" WITH c, db
```

---

### 15. Database Without Read Replica

```
RULE "Database Has No Read Replica"
SEVERITY INFO

MATCH (db:Database)

OPTIONAL (db) -[:ReplicatesTo]-> (replica:Database)

WHERE NOT EXISTS(replica)

YIELD "Database has no read replica" WITH db
```

`NOT EXISTS(replica)` checks whether *this specific database* has a replica, not whether any database in the graph has replication.

---

### 16. No CDN for Public Content

```
RULE "No CDN in Architecture"
SEVERITY INFO

MATCH (c:Client) -> (srv:Server)

WHERE NOT EXISTS((:CDN))

YIELD "No CDN detected — static content may be slow for global users" ONCE
```

`EXISTS((:CDN))` is the degenerate one-node path form — it checks whether any CDN node exists anywhere in the graph.

---

### 17. Server CPU Exceeds Threshold

```
RULE "Server CPU Exceeds Threshold"
SEVERITY WARNING

MATCH (srv:Server)

SIMULATE maxCPU = 85

WHERE srv.cpu > maxCPU

YIELD "Server CPU exceeds acceptable threshold" WITH srv
```

---

### 18. Excessive Message Broker Fan-Out

```
RULE "Excessive Message Fan-Out"
SEVERITY WARNING

MATCH (broker:MessageBroker)

WHERE DEGREE(broker) > 20

YIELD "Message broker fans out to too many consumers — throughput risk" WITH broker
```

---

## Partially Detectable

| Anti-Pattern | What ArchQL Can Detect | What It Cannot |
|---|---|---|
| **Thundering Herd** | Missing CircuitBreaker or Cache between client and server | Actual retry storm behaviour — requires runtime metrics |
| **Hotspot Database** | Single Database with no Cache upstream | Skewed query distribution — requires query-level tracing |
| **Retry Storm** | Deep call chains + missing circuit breaker | Retry policies configured in code — not visible in topology |

## Out of Scope

| Anti-Pattern | Reason |
|---|---|
| **N+1 Query Problem** | Occurs in application code, not architecture topology |
| **Chatty API** | Requires runtime call-frequency data |
| **Leaky Abstraction** | Requires code review and interface contract inspection |
| **Implicit Interface Coupling** | Detectable only via schema/contract analysis |

---

# 25. Complete Rule Example

```
# Detects the most dangerous beginner mistake:
# a client reading directly from a public database with no API gateway
RULE "Client Reads Directly From Public Database"
SEVERITY ERROR

MATCH (c:Client) -[:Reads]-> (db:Database)

OPTIONAL (c) -> (gw:APIGateway)

WHERE NOT EXISTS(gw)
  AND db.public = true

YIELD "Client reads directly from a public database with no API gateway" WITH c, db
```

`NOT EXISTS(gw)` checks whether *this specific client's path* includes a gateway, not whether any gateway exists globally. `db.public = true` narrows the rule to publicly exposed databases only — an internal read that bypasses the gateway is a separate concern.

---

# 26. Future Extensions

| Feature | Priority | Notes |
|---------|----------|-------|
| Graph indexing | High | Required for large graphs (1000+ nodes) to avoid full scans on every rule |
| IDE language server (LSP) | High | Autocomplete, inline errors, and hover docs for `.arch` files |
| Rule packages / imports | Medium | `IMPORT "security_baseline.arch"` |
| CI/CD validation | Medium | `archql validate --graph arch.json --rules rules/` |
| Configurable path depth cap | Medium | Runtime flag to override the default 10-hop maximum |
| `YIELD ONCE BY var` | Low | Emit one violation per distinct value of a variable: `YIELD ONCE BY lb` |
| Architecture auto-fix suggestions | Low | Suggest a canonical remediation pattern alongside each YIELD |

---

*End of ArchQL v3.2 Specification*