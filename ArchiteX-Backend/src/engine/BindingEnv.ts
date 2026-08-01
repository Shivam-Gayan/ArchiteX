/**
 * BindingEnv — a single binding environment produced by the Matcher.
 *
 * Represents one concrete subgraph match for a rule's MATCH (and OPTIONAL)
 * patterns. Each key is an alias from the rule (e.g. "srv", "lb", "conn")
 * and each value is the concrete GraphNode or GraphEdge it is bound to.
 *
 * OPTIONAL bindings are nullable: if an OPTIONAL clause did not match, its
 * alias maps to null — this is the standard ArchQL idiom for "absent component".
 *
 * Example for: MATCH (lb:LoadBalancer) -> (srv:Server)
 *   { lb: GraphNode{id:"n1",...}, srv: GraphNode{id:"n2",...} }
 *
 * Example for: MATCH (api:APIGateway) OPTIONAL (api) -> (auth:AuthService)
 *   { api: GraphNode{...}, auth: null }   ← OPTIONAL did not match
 */

import type { GraphNode } from "../graph/models/GraphNode";
import type { GraphEdge } from "../graph/models/GraphEdge";

export type BoundValue = GraphNode | GraphEdge | null;

export type BindingEnv = Map<string, BoundValue>;
