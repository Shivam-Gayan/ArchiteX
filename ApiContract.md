# ArchiteX — Frontend ↔ Backend API Contract

**Version:** v1.0
**Base URL:** `http://localhost:4000/api/v1` (development)
**Content-Type:** `application/json` for all requests and responses

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Shared Types](#2-shared-types)
3. [Error Envelope](#3-error-envelope)
4. [POST /validate](#4-post-validate) — run rules against a graph
5. [GET /node-types](#5-get-node-types) — canvas palette data
6. [GET /edge-types](#6-get-edge-types) — canvas palette data
7. [GET /rules](#7-get-rules) — list available rules
8. [GET /health](#8-get-health) — engine readiness
9. [HTTP Status Code Reference](#9-http-status-code-reference)
10. [Frontend Integration Notes](#10-frontend-integration-notes)

---

## 1. Conventions

- All request and response bodies are JSON.
- All field names are `camelCase`.
- `string` fields are non-null unless explicitly marked `| null`.
- Properties on nodes and edges are an **open map** — any `string | number | boolean` value is accepted. Unknown keys are passed through to the engine as-is.
- Node and edge IDs are **frontend-assigned** strings. The backend treats them as opaque identifiers. The frontend canvas library (e.g. React Flow) generates these — use whatever it produces.
- Canvas position data (`x`, `y` coordinates) is **not sent to the backend**. It is frontend-only state.
- Validation violations are **not HTTP errors**. A graph with 20 violations returns `200 OK` with a non-empty violations array.

---

## 2. Shared Types

These types are referenced across multiple endpoints.

### NodeType (enum)

Valid values for a node's `type` field:

```
Client | APIGateway | LoadBalancer | Server | Worker
Queue | MessageBroker | StreamProcessor | Cache | Database
SearchEngine | ObjectStorage | CDN | AuthService
RateLimiter | CircuitBreaker | ServiceMesh
Monitoring | Logging | Tracing
```

### EdgeType (enum)

Valid values for an edge's `type` field:

```
Traffic | Reads | Writes | Calls | ReplicatesTo
Publishes | Consumes | Streams | Proxies
```

### SeverityLevel (enum)

```
ERROR | WARNING | INFO | HINT
```

### NodeObject

Represents one node in the graph sent from the frontend.

```typescript
{
  id:         string             // unique within this request, e.g. "node_lb_1"
  type:       NodeType           // must be one of the valid NodeType values
  label:      string             // display name shown on canvas, e.g. "Primary DB"
  properties: Record<string, string | number | boolean>  // open map
}
```

**Required fields:** `id`, `type`
**Optional fields:** `label` (defaults to `type` if absent), `properties` (defaults to `{}`)

**Example:**

```json
{
  "id": "node_srv_1",
  "type": "Server",
  "label": "Auth Service",
  "properties": {
    "instances": 1,
    "region": "us-east",
    "cpu": 72,
    "public": false
  }
}
```

### EdgeObject

Represents one directed edge in the graph.

```typescript
{
  id:         string             // unique within this request, e.g. "edge_1"
  type:       EdgeType           // must be one of the valid EdgeType values
  sourceId:   string             // id of the source node
  targetId:   string             // id of the target node
  properties: Record<string, string | number | boolean>
}
```

**Required fields:** `id`, `sourceId`, `targetId`
**Optional fields:** `type` (defaults to `"Traffic"` if absent), `properties` (defaults to `{}`)

**Example:**

```json
{
  "id": "edge_3",
  "type": "Writes",
  "sourceId": "node_srv_1",
  "targetId": "node_db_1",
  "properties": {
    "encrypted": false,
    "protocol": "TCP"
  }
}
```

### ViolationObject

One rule violation returned in a validate response.

```typescript
{
  ruleName:           string         // the RULE name from the .arch file
  severity:           SeverityLevel
  message:            string         // the YIELD message string
  highlightedNodeIds: string[]       // IDs of nodes to highlight on canvas (from YIELD WITH)
  ruleFile:           string         // which .arch file the rule came from
}
```

**Example:**

```json
{
  "ruleName": "Single Server Behind Load Balancer",
  "severity": "ERROR",
  "message": "Load balancer has fewer than 2 servers — single point of failure",
  "highlightedNodeIds": ["node_lb_1", "node_srv_3"],
  "ruleFile": "availability_rules.arch"
}
```

---

## 3. Error Envelope

All non-2xx responses use this shape:

```typescript
{
  error: {
    code:    string    // machine-readable error code
    message: string    // human-readable description
    details: FieldError[] | null   // field-level errors for 422
  }
}
```

### FieldError

```typescript
{
  field:   string   // JSON path to the offending field, e.g. "nodes[2].type"
  issue:   string   // description of the problem
  value:   unknown  // the value that was rejected (optional)
}
```

**Example 422 response:**

```json
{
  "error": {
    "code": "GRAPH_VALIDATION_FAILED",
    "message": "The graph contains invalid fields that cannot be processed.",
    "details": [
      {
        "field": "nodes[2].type",
        "issue": "Unknown node type. Must be one of: Client, APIGateway, LoadBalancer, ...",
        "value": "server"
      },
      {
        "field": "edges[0].targetId",
        "issue": "Target node 'node_xyz_99' does not exist in the nodes array.",
        "value": "node_xyz_99"
      }
    ]
  }
}
```

**Example 500 response:**

```json
{
  "error": {
    "code": "ENGINE_ERROR",
    "message": "Rule evaluation failed unexpectedly. Please try again.",
    "details": null
  }
}
```

---

## 4. POST /validate

The primary endpoint. The frontend sends the full graph and simulation overrides; the backend runs all matching rules and returns every violation.

### Request

```
POST /api/v1/validate
Content-Type: application/json
```

#### Body

```typescript
{
  graph: {
    nodes: NodeObject[]
    edges: EdgeObject[]
  }
  simulation: Record<string, number> | null   // simulation variable overrides
  ruleFilter: {
    categories: RuleCategory[] | null          // null = run all categories
    excludeRules: string[] | null              // rule names to skip
  } | null                                    // null = run all rules
}
```

#### RuleCategory (enum)

```
security | availability | performance | scalability
```

#### Request Constraints (validated before rule execution)

| Constraint | Error code |
|---|---|
| `nodes` must be an array (may be empty) | `GRAPH_VALIDATION_FAILED` |
| `edges` must be an array (may be empty) | `GRAPH_VALIDATION_FAILED` |
| Every `node.id` must be unique within the request | `GRAPH_VALIDATION_FAILED` |
| Every `edge.id` must be unique within the request | `GRAPH_VALIDATION_FAILED` |
| Every `edge.sourceId` must reference an existing `node.id` | `GRAPH_VALIDATION_FAILED` |
| Every `edge.targetId` must reference an existing `node.id` | `GRAPH_VALIDATION_FAILED` |
| `edge.sourceId` and `edge.targetId` may be the same node (self-loop) | *(allowed)* |
| Every `node.type` must be a valid `NodeType` value | `GRAPH_VALIDATION_FAILED` |
| Every `edge.type`, if provided, must be a valid `EdgeType` | `GRAPH_VALIDATION_FAILED` |
| `simulation` values must be numbers | `GRAPH_VALIDATION_FAILED` |
| An empty graph (0 nodes, 0 edges) is valid | *(200, empty violations)* |

#### Full Request Example

```json
{
  "graph": {
    "nodes": [
      {
        "id": "node_client_1",
        "type": "Client",
        "label": "Web Browser"
      },
      {
        "id": "node_lb_1",
        "type": "LoadBalancer",
        "label": "Main LB"
      },
      {
        "id": "node_srv_1",
        "type": "Server",
        "label": "App Server",
        "properties": {
          "instances": 1,
          "cpu": 65,
          "region": "us-east"
        }
      },
      {
        "id": "node_db_1",
        "type": "Database",
        "label": "Primary DB",
        "properties": {
          "public": false,
          "encrypted": true
        }
      }
    ],
    "edges": [
      {
        "id": "edge_1",
        "type": "Traffic",
        "sourceId": "node_client_1",
        "targetId": "node_lb_1"
      },
      {
        "id": "edge_2",
        "type": "Traffic",
        "sourceId": "node_lb_1",
        "targetId": "node_srv_1"
      },
      {
        "id": "edge_3",
        "type": "Writes",
        "sourceId": "node_srv_1",
        "targetId": "node_db_1",
        "properties": {
          "encrypted": false
        }
      }
    ]
  },
  "simulation": {
    "traffic": 15000,
    "maxCPU": 80
  },
  "ruleFilter": {
    "categories": ["security", "availability"],
    "excludeRules": null
  }
}
```

---

### Response — 200 OK

```typescript
{
  violations: ViolationObject[]
  meta: {
    totalViolations: number
    bySeverity: {
      ERROR:   number
      WARNING: number
      INFO:    number
      HINT:    number
    }
    rulesEvaluated:  number
    nodesEvaluated:  number
    edgesEvaluated:  number
    durationMs:      number
  }
}
```

#### Full Response Example

```json
{
  "violations": [
    {
      "ruleName": "Single Server Behind Load Balancer",
      "severity": "ERROR",
      "message": "Load balancer has fewer than 2 servers — single point of failure",
      "highlightedNodeIds": ["node_lb_1", "node_srv_1"],
      "ruleFile": "availability_rules.arch"
    },
    {
      "ruleName": "Unencrypted Database Connection",
      "severity": "ERROR",
      "message": "Database write connection is not encrypted",
      "highlightedNodeIds": ["node_srv_1", "node_db_1"],
      "ruleFile": "security_rules.arch"
    },
    {
      "ruleName": "No Monitoring Configured",
      "severity": "WARNING",
      "message": "Server has no monitoring attached",
      "highlightedNodeIds": ["node_srv_1"],
      "ruleFile": "availability_rules.arch"
    }
  ],
  "meta": {
    "totalViolations": 3,
    "bySeverity": {
      "ERROR": 2,
      "WARNING": 1,
      "INFO": 0,
      "HINT": 0
    },
    "rulesEvaluated": 12,
    "nodesEvaluated": 4,
    "edgesEvaluated": 3,
    "durationMs": 14
  }
}
```

#### Empty graph response (no violations)

```json
{
  "violations": [],
  "meta": {
    "totalViolations": 0,
    "bySeverity": { "ERROR": 0, "WARNING": 0, "INFO": 0, "HINT": 0 },
    "rulesEvaluated": 12,
    "nodesEvaluated": 0,
    "edgesEvaluated": 0,
    "durationMs": 2
  }
}
```

---

### Response — 422 Unprocessable Entity

Returned when the request body is structurally valid JSON but the graph fails schema validation. Rules are **not executed**.

```json
{
  "error": {
    "code": "GRAPH_VALIDATION_FAILED",
    "message": "The graph contains invalid fields that cannot be processed.",
    "details": [
      {
        "field": "nodes[2].type",
        "issue": "Unknown node type. Valid values: Client, APIGateway, LoadBalancer, Server, Worker, Queue, MessageBroker, StreamProcessor, Cache, Database, SearchEngine, ObjectStorage, CDN, AuthService, RateLimiter, CircuitBreaker, ServiceMesh, Monitoring, Logging, Tracing",
        "value": "server"
      }
    ]
  }
}
```

### Response — 400 Bad Request

Returned when the request body is not valid JSON.

```json
{
  "error": {
    "code": "INVALID_JSON",
    "message": "Request body is not valid JSON.",
    "details": null
  }
}
```

### Response — 503 Service Unavailable

Returned when the rule engine has not finished loading or failed to start.

```json
{
  "error": {
    "code": "ENGINE_NOT_READY",
    "message": "The rule engine is still initialising. Please retry in a moment.",
    "details": null
  }
}
```

---

## 5. GET /node-types

Returns all valid node types with metadata. Used by the frontend canvas palette to populate the component sidebar.

### Request

```
GET /api/v1/node-types
```

No body, no query parameters.

### Response — 200 OK

```typescript
{
  nodeTypes: {
    type:        string    // the NodeType value, e.g. "Server"
    label:       string    // display name, e.g. "Server"
    description: string    // short description for tooltip
    category:    string    // grouping for palette UI
    icon:        string    // icon name (matches frontend icon set)
  }[]
}
```

#### Category values

```
compute | networking | data | messaging | observability | security
```

#### Full Response Example

```json
{
  "nodeTypes": [
    {
      "type": "Client",
      "label": "Client",
      "description": "End-user or external caller",
      "category": "networking",
      "icon": "monitor"
    },
    {
      "type": "APIGateway",
      "label": "API Gateway",
      "description": "API gateway / reverse proxy entry point",
      "category": "networking",
      "icon": "gateway"
    },
    {
      "type": "LoadBalancer",
      "label": "Load Balancer",
      "description": "Traffic distribution layer",
      "category": "networking",
      "icon": "balance"
    },
    {
      "type": "Server",
      "label": "Server",
      "description": "Application or service instance",
      "category": "compute",
      "icon": "server"
    },
    {
      "type": "Worker",
      "label": "Worker",
      "description": "Background processing unit",
      "category": "compute",
      "icon": "cpu"
    },
    {
      "type": "Database",
      "label": "Database",
      "description": "Persistent data store",
      "category": "data",
      "icon": "database"
    },
    {
      "type": "Cache",
      "label": "Cache",
      "description": "In-memory cache (e.g. Redis, Memcached)",
      "category": "data",
      "icon": "zap"
    },
    {
      "type": "Queue",
      "label": "Queue",
      "description": "Message queue (e.g. SQS, RabbitMQ)",
      "category": "messaging",
      "icon": "list"
    },
    {
      "type": "MessageBroker",
      "label": "Message Broker",
      "description": "Pub/sub broker (e.g. Kafka)",
      "category": "messaging",
      "icon": "share-2"
    },
    {
      "type": "StreamProcessor",
      "label": "Stream Processor",
      "description": "Stream computation (e.g. Flink, Spark)",
      "category": "messaging",
      "icon": "activity"
    },
    {
      "type": "SearchEngine",
      "label": "Search Engine",
      "description": "Full-text search (e.g. Elasticsearch)",
      "category": "data",
      "icon": "search"
    },
    {
      "type": "ObjectStorage",
      "label": "Object Storage",
      "description": "Blob / file storage (e.g. S3)",
      "category": "data",
      "icon": "archive"
    },
    {
      "type": "CDN",
      "label": "CDN",
      "description": "Content delivery network",
      "category": "networking",
      "icon": "globe"
    },
    {
      "type": "AuthService",
      "label": "Auth Service",
      "description": "Authentication / authorization service",
      "category": "security",
      "icon": "shield"
    },
    {
      "type": "RateLimiter",
      "label": "Rate Limiter",
      "description": "Request rate control layer",
      "category": "security",
      "icon": "sliders"
    },
    {
      "type": "CircuitBreaker",
      "label": "Circuit Breaker",
      "description": "Fault isolation proxy",
      "category": "security",
      "icon": "alert-triangle"
    },
    {
      "type": "ServiceMesh",
      "label": "Service Mesh",
      "description": "Service-to-service networking layer",
      "category": "networking",
      "icon": "grid"
    },
    {
      "type": "Monitoring",
      "label": "Monitoring",
      "description": "Metrics collection (e.g. Prometheus, Datadog)",
      "category": "observability",
      "icon": "bar-chart-2"
    },
    {
      "type": "Logging",
      "label": "Logging",
      "description": "Log aggregation (e.g. ELK stack)",
      "category": "observability",
      "icon": "file-text"
    },
    {
      "type": "Tracing",
      "label": "Tracing",
      "description": "Distributed tracing (e.g. Jaeger, Zipkin)",
      "category": "observability",
      "icon": "git-merge"
    }
  ]
}
```

---

## 6. GET /edge-types

Returns all valid edge types with metadata.

### Request

```
GET /api/v1/edge-types
```

### Response — 200 OK

```typescript
{
  edgeTypes: {
    type:          string
    label:         string
    description:   string
    directed:      boolean    // false = undirected edge (all current types are directed)
    defaultColor:  string     // hex color for the canvas edge line
  }[]
}
```

#### Full Response Example

```json
{
  "edgeTypes": [
    {
      "type": "Traffic",
      "label": "Traffic",
      "description": "Generic HTTP / TCP traffic",
      "directed": true,
      "defaultColor": "#6366F1"
    },
    {
      "type": "Reads",
      "label": "Reads",
      "description": "Data read operation",
      "directed": true,
      "defaultColor": "#22C55E"
    },
    {
      "type": "Writes",
      "label": "Writes",
      "description": "Data write operation",
      "directed": true,
      "defaultColor": "#EF4444"
    },
    {
      "type": "Calls",
      "label": "Calls",
      "description": "Synchronous RPC / API call",
      "directed": true,
      "defaultColor": "#F59E0B"
    },
    {
      "type": "ReplicatesTo",
      "label": "Replicates To",
      "description": "Data replication link",
      "directed": true,
      "defaultColor": "#8B5CF6"
    },
    {
      "type": "Publishes",
      "label": "Publishes",
      "description": "Message publication",
      "directed": true,
      "defaultColor": "#06B6D4"
    },
    {
      "type": "Consumes",
      "label": "Consumes",
      "description": "Message consumption",
      "directed": true,
      "defaultColor": "#0EA5E9"
    },
    {
      "type": "Streams",
      "label": "Streams",
      "description": "Streaming data flow",
      "directed": true,
      "defaultColor": "#14B8A6"
    },
    {
      "type": "Proxies",
      "label": "Proxies",
      "description": "Traffic proxying (ServiceMesh, CircuitBreaker)",
      "directed": true,
      "defaultColor": "#A855F7"
    }
  ]
}
```

---

## 7. GET /rules

Returns all loaded rules with metadata. Used by the frontend's rule browser panel to show what rules are active and let the user understand what is being checked.

### Request

```
GET /api/v1/rules
```

#### Query Parameters (all optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `category` | string | Filter by rule category: `security`, `availability`, `performance`, `scalability` |
| `severity` | string | Filter by severity: `ERROR`, `WARNING`, `INFO`, `HINT` |

Example:

```
GET /api/v1/rules?category=security&severity=ERROR
```

### Response — 200 OK

```typescript
{
  rules: {
    name:       string
    severity:   SeverityLevel
    category:   string
    file:       string          // which .arch file it came from
    yieldMessage: string        // the YIELD message template
    hasSimulation: boolean      // true if the rule uses SIMULATE
  }[]
  total: number
}
```

#### Full Response Example

```json
{
  "rules": [
    {
      "name": "Single Server Behind Load Balancer",
      "severity": "ERROR",
      "category": "availability",
      "file": "availability_rules.arch",
      "yieldMessage": "Load balancer has fewer than 2 servers — single point of failure",
      "hasSimulation": false
    },
    {
      "name": "Database Exposed to Internet",
      "severity": "ERROR",
      "category": "security",
      "file": "security_rules.arch",
      "yieldMessage": "Database is publicly accessible — critical security risk",
      "hasSimulation": false
    },
    {
      "name": "Server CPU Exceeds Threshold",
      "severity": "WARNING",
      "category": "performance",
      "file": "performance_rules.arch",
      "yieldMessage": "Server CPU exceeds acceptable threshold",
      "hasSimulation": true
    }
  ],
  "total": 3
}
```

---

## 8. GET /health

Backend health and rule engine readiness check. Called by the frontend on startup to verify the backend is ready before enabling the validate button.

### Request

```
GET /api/v1/health
```

### Response — 200 OK (ready)

```json
{
  "status": "ok",
  "engine": {
    "ready": true,
    "rulesLoaded": 18,
    "ruleFiles": [
      "security_rules.arch",
      "availability_rules.arch",
      "performance_rules.arch",
      "scalability_rules.arch"
    ]
  },
  "version": "1.0.0"
}
```

### Response — 503 Service Unavailable (not ready)

```json
{
  "status": "unavailable",
  "engine": {
    "ready": false,
    "rulesLoaded": 0,
    "ruleFiles": []
  },
  "version": "1.0.0"
}
```

---

## 9. HTTP Status Code Reference

| Code | When |
|------|------|
| `200 OK` | Request succeeded. Violations in the body are not HTTP errors. |
| `400 Bad Request` | Request body is not valid JSON. |
| `404 Not Found` | Endpoint does not exist. |
| `422 Unprocessable Entity` | JSON is valid but graph fails schema validation. Rules not run. |
| `500 Internal Server Error` | Unexpected engine error. |
| `503 Service Unavailable` | Engine not ready. Frontend should retry with backoff. |

---

## 10. Frontend Integration Notes

### When to call /validate

Call `/validate` on every canvas change after a **300ms debounce**. Do not call on every keystroke or every node drag event — wait until the user pauses. Cancel any in-flight request if a new change comes in before it completes.

```
canvas change event
  → reset 300ms debounce timer
  → on timer expiry: cancel previous request if pending, fire new /validate
```

### Node highlighting

The `highlightedNodeIds` array in each violation maps directly to node `id` values in your canvas state. On receiving a validate response:

1. Clear all existing highlights on the canvas.
2. For each violation, apply a border colour to each node in `highlightedNodeIds`:
   - `ERROR` → red border
   - `WARNING` → amber border
   - `INFO` → blue border
   - `HINT` → grey border
3. If a node appears in multiple violations with different severities, use the highest severity colour.

### Severity priority order (highest to lowest)

```
ERROR > WARNING > INFO > HINT
```

### Simulation panel

The simulation panel sends user-set values as `simulation` in the request body. Only send keys where the user has explicitly set a value. Do not send `null` values — omit the key entirely.

```
// User set traffic=15000, left everything else as rule defaults
{
  "simulation": {
    "traffic": 15000
  }
}

// User set nothing — send null or omit the field entirely
{
  "simulation": null
}
```

### Rule filter

The rule filter lets users toggle rule categories from the sidebar. Send the active categories as an array. If all categories are active, send `null` to run all rules (more efficient than listing them all).

```
// All categories active — run everything
{ "ruleFilter": null }

// Only security and availability
{ "ruleFilter": { "categories": ["security", "availability"], "excludeRules": null } }

// All categories but skip one specific noisy rule
{ "ruleFilter": { "categories": null, "excludeRules": ["No CDN in Architecture"] } }
```

### Health check on startup

```
app starts
  → GET /api/v1/health
  → if ready: enable validate, load palette from /node-types and /edge-types
  → if not ready: show "engine loading" banner, retry after 2s
```

The palette endpoints (`/node-types`, `/edge-types`, `/rules`) are static — call them once on startup and cache the result. They do not change at runtime.

### CORS

The backend must return the following headers for all responses:

```
Access-Control-Allow-Origin: http://localhost:3000
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Adjust the origin to match your frontend dev server port.

---

*End of ArchiteX API Contract v1.0*