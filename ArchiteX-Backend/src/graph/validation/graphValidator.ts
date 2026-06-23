import { isValidNodeType } from "../../shared/nodeTypes";
import { isValidEdgeType, DEFAULT_EDGE_TYPE } from "../../shared/edgeTypes";
import type { GraphNode } from "../models/GraphNode";
import type { GraphEdge } from "../models/GraphEdge";

/**
 * A field-level validation error.
 * Matches FieldError shape in ApiContract.md §3.
 */
export interface FieldError {
  field: string;
  issue: string;
  value?: unknown;
}

/**
 * Result of validating the incoming graph payload.
 * On success, contains normalised domain models ready to build GraphContext.
 * On failure, contains the list of field errors to return as 422.
 */
export type GraphValidationResult =
  | { success: true; nodes: GraphNode[]; edges: GraphEdge[] }
  | { success: false; errors: FieldError[] };

// Raw incoming shapes (from the request body — not yet trusted)
interface RawNode {
  id?: unknown;
  type?: unknown;
  label?: unknown;
  properties?: unknown;
}

interface RawEdge {
  id?: unknown;
  type?: unknown;
  sourceId?: unknown;
  targetId?: unknown;
  properties?: unknown;
}

/**
 * Validates and normalises the graph payload from POST /validate.
 *
 * Enforces all constraints from ApiContract.md §4 "Request Constraints":
 * 1. `nodes` must be an array (may be empty)
 * 2. `edges` must be an array (may be empty)
 * 3. Every node.id must be unique within the request
 * 4. Every edge.id must be unique within the request
 * 5. Every edge.sourceId must reference an existing node.id
 * 6. Every edge.targetId must reference an existing node.id
 * 7. Self-loops (sourceId === targetId) are allowed
 * 8. Every node.type must be a valid NodeType value
 * 9. Every edge.type, if provided, must be a valid EdgeType
 * 10. An empty graph is valid — returns 200 with empty violations
 *
 * On success, properties is normalised:
 * - node.label defaults to node.type if absent
 * - node.properties defaults to {} if absent
 * - edge.type defaults to "Traffic" if absent
 * - edge.properties defaults to {} if absent
 */
export function validateAndNormaliseGraph(
  rawNodes: unknown,
  rawEdges: unknown
): GraphValidationResult {
  const errors: FieldError[] = [];

  // Constraint 1 & 2: arrays
  if (!Array.isArray(rawNodes)) {
    errors.push({ field: "nodes", issue: "nodes must be an array" });
  }
  if (!Array.isArray(rawEdges)) {
    errors.push({ field: "edges", issue: "edges must be an array" });
  }
  if (errors.length > 0) return { success: false, errors };

  const nodeArr = rawNodes as RawNode[];
  const edgeArr = rawEdges as RawEdge[];

  // --- Validate nodes ---
  const nodeIds = new Set<string>();
  const validNodes: GraphNode[] = [];

  for (let i = 0; i < nodeArr.length; i++) {
    const raw = nodeArr[i];
    const prefix = `nodes[${i}]`;

    // id must be a non-empty string
    if (typeof raw.id !== "string" || raw.id.trim() === "") {
      errors.push({
        field: `${prefix}.id`,
        issue: "id must be a non-empty string",
        value: raw.id,
      });
      continue;
    }

    // Constraint 3: unique node ids
    if (nodeIds.has(raw.id)) {
      errors.push({
        field: `${prefix}.id`,
        issue: `Duplicate node id '${raw.id}'`,
        value: raw.id,
      });
      continue;
    }

    // Constraint 8: valid NodeType
    if (typeof raw.type !== "string" || !isValidNodeType(raw.type)) {
      errors.push({
        field: `${prefix}.type`,
        issue:
          "Unknown node type. Must be one of: Client, APIGateway, LoadBalancer, " +
          "Server, Worker, Queue, MessageBroker, StreamProcessor, Cache, Database, " +
          "SearchEngine, ObjectStorage, CDN, AuthService, RateLimiter, CircuitBreaker, " +
          "ServiceMesh, Monitoring, Logging, Tracing",
        value: raw.type,
      });
      continue;
    }

    // Validate properties if present — must be a plain object with string/number/boolean values
    const rawProps = raw.properties;
    let properties: Record<string, string | number | boolean> = {};
    if (rawProps !== undefined && rawProps !== null) {
      if (typeof rawProps !== "object" || Array.isArray(rawProps)) {
        errors.push({
          field: `${prefix}.properties`,
          issue: "properties must be a plain object",
          value: rawProps,
        });
        continue;
      }
      for (const [key, val] of Object.entries(rawProps)) {
        if (
          typeof val !== "string" &&
          typeof val !== "number" &&
          typeof val !== "boolean"
        ) {
          errors.push({
            field: `${prefix}.properties.${key}`,
            issue: "Property values must be string, number, or boolean",
            value: val,
          });
        } else {
          properties[key] = val;
        }
      }
    }

    // Normalise: label defaults to type
    const label =
      typeof raw.label === "string" && raw.label.trim() !== ""
        ? raw.label
        : raw.type;

    nodeIds.add(raw.id);
    validNodes.push({
      id: raw.id,
      type: raw.type,
      label,
      properties,
    });
  }

  // --- Validate edges ---
  const edgeIds = new Set<string>();
  const validEdges: GraphEdge[] = [];

  for (let i = 0; i < edgeArr.length; i++) {
    const raw = edgeArr[i];
    const prefix = `edges[${i}]`;

    // id must be a non-empty string
    if (typeof raw.id !== "string" || raw.id.trim() === "") {
      errors.push({
        field: `${prefix}.id`,
        issue: "id must be a non-empty string",
        value: raw.id,
      });
      continue;
    }

    // Constraint 4: unique edge ids
    if (edgeIds.has(raw.id)) {
      errors.push({
        field: `${prefix}.id`,
        issue: `Duplicate edge id '${raw.id}'`,
        value: raw.id,
      });
      continue;
    }

    // sourceId and targetId must be strings
    if (typeof raw.sourceId !== "string") {
      errors.push({
        field: `${prefix}.sourceId`,
        issue: "sourceId must be a string",
        value: raw.sourceId,
      });
      continue;
    }
    if (typeof raw.targetId !== "string") {
      errors.push({
        field: `${prefix}.targetId`,
        issue: "targetId must be a string",
        value: raw.targetId,
      });
      continue;
    }

    // Constraint 5 & 6: references must exist in nodes
    if (!nodeIds.has(raw.sourceId)) {
      errors.push({
        field: `${prefix}.sourceId`,
        issue: `Source node '${raw.sourceId}' does not exist in the nodes array`,
        value: raw.sourceId,
      });
    }
    if (!nodeIds.has(raw.targetId)) {
      errors.push({
        field: `${prefix}.targetId`,
        issue: `Target node '${raw.targetId}' does not exist in the nodes array`,
        value: raw.targetId,
      });
    }

    // Constraint 9: valid EdgeType (optional field, defaults to "Traffic")
    let edgeType: string = DEFAULT_EDGE_TYPE;
    if (raw.type !== undefined) {
      if (typeof raw.type !== "string" || !isValidEdgeType(raw.type)) {
        errors.push({
          field: `${prefix}.type`,
          issue:
            "Unknown edge type. Must be one of: Traffic, Reads, Writes, Calls, " +
            "ReplicatesTo, Publishes, Consumes, Streams, Proxies",
          value: raw.type,
        });
        continue;
      }
      edgeType = raw.type;
    }

    // Validate properties
    const rawProps = raw.properties;
    let properties: Record<string, string | number | boolean> = {};
    if (rawProps !== undefined && rawProps !== null) {
      if (typeof rawProps !== "object" || Array.isArray(rawProps)) {
        errors.push({
          field: `${prefix}.properties`,
          issue: "properties must be a plain object",
          value: rawProps,
        });
        continue;
      }
      for (const [key, val] of Object.entries(rawProps)) {
        if (
          typeof val !== "string" &&
          typeof val !== "number" &&
          typeof val !== "boolean"
        ) {
          errors.push({
            field: `${prefix}.properties.${key}`,
            issue: "Property values must be string, number, or boolean",
            value: val,
          });
        } else {
          properties[key] = val;
        }
      }
    }

    edgeIds.add(raw.id);
    validEdges.push({
      id: raw.id,
      type: edgeType,
      sourceId: raw.sourceId,
      targetId: raw.targetId,
      properties,
    });
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, nodes: validNodes, edges: validEdges };
}
