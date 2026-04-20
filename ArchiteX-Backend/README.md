#  ArchiteX Backend — Project Structure

**Compiler Pipeline**:

```
HTTP (Express)
   ↓
Application (Use Cases)
   ↓
Core Engine (DSL + Graph Processing)
   ↓
Infrastructure (files, config, logging)
```

---

# Folder Structure

```
src/
│
├── core/                     # PURE ENGINE (NO EXPRESS / HTTP)
│   ├── lexer/               # Tokenization of .arch rules
│   ├── parser/              # Builds AST from tokens
│   ├── ast/                 # AST node definitions
│   ├── semantic/            # Semantic validation (bindings, types)
│   ├── graph/               # Graph model (nodes, edges)
│   ├── matcher/             # Pattern matching engine
│   ├── evaluator/           # WHERE, aggregates, DEGREE, EXISTS
│   ├── diagnostics/         # Builds violation output
│   └── engine.ts            # Orchestrates full pipeline
│
├── application/             # USE CASES (business logic)
│   ├── validateGraph/
│   │   ├── validateGraph.usecase.ts
│   │   └── validateGraph.mapper.ts   # builds response meta
│   │
│   ├── getRules/
│   ├── getNodeTypes/
│   ├── getEdgeTypes/
│   └── health/
│
├── domain/                  # DOMAIN MODELS (pure types)
│   ├── graph/
│   │   ├── Node.ts
│   │   ├── Edge.ts
│   │   └── Graph.ts
│   │
│   ├── rule/
│   │   ├── Rule.ts
│   │   └── RuleCategory.ts
│   │
│   ├── enums/
│   │   ├── NodeTypes.ts
│   │   ├── EdgeTypes.ts
│   │   └── Severity.ts
│   │
│   └── violation/
│       └── Violation.ts
│
├── infrastructure/          # EXTERNAL DEPENDENCIES
│   ├── rules/
│   │   ├── loader.ts        # loads .arch files
│   │   └── registry.ts      # stores parsed rules in memory
│   │
│   ├── file/
│   │   └── fileReader.ts
│   │
│   ├── config/
│   │   └── engineConfig.ts
│   │
│   └── logger/
│       └── logger.ts
│
├── interfaces/              # DELIVERY LAYER (HTTP)
│   ├── http/
│   │   ├── controllers/     # API controllers
│   │   │   ├── validate.controller.ts
│   │   │   ├── rules.controller.ts
│   │   │   ├── nodeTypes.controller.ts
│   │   │   ├── edgeTypes.controller.ts
│   │   │   └── health.controller.ts
│   │   │
│   │   ├── routes/
│   │   │   └── api.routes.ts
│   │   │
│   │   ├── middleware/
│   │   │   ├── errorHandler.ts
│   │   │   ├── validateRequest.ts   # 422 validation
│   │   │   └── cors.ts
│   │   │
│   │   └── server.ts        # Express app setup
│   │
│   └── dto/                 # Request/Response contracts
│       ├── validate.dto.ts
│       ├── node.dto.ts
│       ├── edge.dto.ts
│       └── error.dto.ts
│
├── constants/               # STATIC DATA (API contract)
│   ├── nodeTypes.ts
│   ├── edgeTypes.ts
│   └── ruleCategories.ts
│
├── utils/                   # HELPER FUNCTIONS
│   ├── idValidator.ts
│   └── performanceTimer.ts
│
├── rules/                   # ArchQL rule files
│   ├── security_rules.arch
│   ├── availability_rules.arch
│   ├── performance_rules.arch
│   └── scalability_rules.arch
│
├── bootstrap/               # STARTUP LOGIC
│   └── initEngine.ts        # loads rules at startup
│
└── index.ts                 # ENTRY POINT
```

# Request Flow (Important)

### POST `/validate`

```
Client Request
   ↓
Controller (validate.controller.ts)
   ↓
DTO Validation (422 if invalid)
   ↓
Use Case (validateGraph.usecase.ts)
   ↓
Core Engine (engine.ts)
   ├─ Lexer
   ├─ Parser
   ├─ Semantic Analyzer
   ├─ Graph Matcher
   ├─ Rule Evaluator
   └─ Diagnostics Builder
   ↓
Response Mapper (meta info)
   ↓
JSON Response
```

---

# 🧠 Key Design Principles

### 1. Core is framework-independent

* No Express inside `core/`
* Fully reusable engine

---

### 2. Separation of concerns

| Layer          | Responsibility    |
| -------------- | ----------------- |
| core           | DSL + rule engine |
| application    | use cases         |
| domain         | types/models      |
| infrastructure | external systems  |
| interfaces     | HTTP/API          |

---

### 3. Rules are loaded once

```
startup → load .arch → parse → store AST
request → reuse AST (no re-parsing)
```

---

### 4. Validation happens before engine

* Invalid graph → **422 error**
* Engine only runs on valid input




