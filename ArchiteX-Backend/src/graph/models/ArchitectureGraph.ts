import type { GraphContext } from "../contracts/GraphContext";
import type { GraphNode } from "./GraphNode";
import type { GraphEdge } from "./GraphEdge";

/**
 * ArchitectureGraph — Dev A's concrete, indexed implementation of GraphContext.
 *
 * Built once per /validate request from the validated, normalised graph payload.
 * Designed for fast lookups with pre-built adjacency maps.
 *
 * The compiler accesses this ONLY through the GraphContext interface.
 * This class should never be imported by the compiler directly.
 */
export class ArchitectureGraph implements GraphContext {
  /** All nodes indexed by id for O(1) lookup */
  private readonly nodesById: Map<string, GraphNode>;

  /** All nodes grouped by type for O(1) type lookup */
  private readonly nodesByType: Map<string, GraphNode[]>;

  /** All edges indexed by id */
  private readonly edgesById: Map<string, GraphEdge>;

  /** Outgoing edges per node: nodeId -> edges[] */
  private readonly outgoing: Map<string, GraphEdge[]>;

  /** Incoming edges per node: nodeId -> edges[] */
  private readonly incoming: Map<string, GraphEdge[]>;

  constructor(nodes: GraphNode[], edges: GraphEdge[]) {
    this.nodesById = new Map();
    this.nodesByType = new Map();
    this.edgesById = new Map();
    this.outgoing = new Map();
    this.incoming = new Map();

    // Index nodes
    for (const node of nodes) {
      this.nodesById.set(node.id, node);

      if (!this.nodesByType.has(node.type)) {
        this.nodesByType.set(node.type, []);
      }
      this.nodesByType.get(node.type)!.push(node);

      // Pre-initialise adjacency lists so getDegree is always defined
      this.outgoing.set(node.id, []);
      this.incoming.set(node.id, []);
    }

    // Index edges
    for (const edge of edges) {
      this.edgesById.set(edge.id, edge);
      this.outgoing.get(edge.sourceId)?.push(edge);
      this.incoming.get(edge.targetId)?.push(edge);
    }
  }

  getNodes(): ReadonlyArray<GraphNode> {
    return Array.from(this.nodesById.values());
  }

  getNodesByType(type: string): ReadonlyArray<GraphNode> {
    return this.nodesByType.get(type) ?? [];
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodesById.get(id);
  }

  getOutgoingEdges(nodeId: string, edgeType?: string): ReadonlyArray<GraphEdge> {
    const edges = this.outgoing.get(nodeId) ?? [];
    if (edgeType === undefined) return edges;
    return edges.filter((e) => e.type === edgeType);
  }

  getIncomingEdges(nodeId: string, edgeType?: string): ReadonlyArray<GraphEdge> {
    const edges = this.incoming.get(nodeId) ?? [];
    if (edgeType === undefined) return edges;
    return edges.filter((e) => e.type === edgeType);
  }

  getEdges(): ReadonlyArray<GraphEdge> {
    return Array.from(this.edgesById.values());
  }

  getNodeProperty(
    nodeId: string,
    property: string
  ): string | number | boolean | undefined {
    return this.nodesById.get(nodeId)?.properties[property];
  }

  getEdgeProperty(
    edgeId: string,
    property: string
  ): string | number | boolean | undefined {
    return this.edgesById.get(edgeId)?.properties[property];
  }

  /**
   * DEGREE(var) — total outbound edges regardless of type.
   * ArchQL_v3_2.md §10: "Returns the number of direct outbound edges
   * from a node, regardless of type."
   */
  getDegree(nodeId: string): number {
    return this.outgoing.get(nodeId)?.length ?? 0;
  }
}
