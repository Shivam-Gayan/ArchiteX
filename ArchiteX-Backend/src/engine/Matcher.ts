/**
 * Matcher — ArchQL Graph Pattern Matcher
 *
 * Takes a PatternNode (MATCH or OPTIONAL clause) and a GraphContext, and
 * returns all BindingEnvs (sets of concrete node/edge bindings) that
 * satisfy the pattern.
 *
 * Implementation strategy: linear path traversal.
 * A PatternNode is always a linear sequence of alternating node/edge patterns:
 *   NodePattern EdgePattern NodePattern [EdgePattern NodePattern ...]
 *
 * We enumerate seed nodes for the first NodePattern, then extend each partial
 * binding by following edges to match subsequent patterns in sequence.
 *
 * Edge depth (*min..max) is implemented via BFS.
 *
 * Node property filters are tested here at match time — a node that does not
 * satisfy its inline property constraints is not bound.
 *
 * Spec refs: ArchQL_v3_2.md §12 (Pattern Matching), §13 (Nodes), §14 (Edges),
 *            §15 (Path Depth), §16 (Traversal)
 */

import type { GraphContext } from "../graph/contracts/GraphContext";
import type { GraphNode } from "../graph/models/GraphNode";
import type { GraphEdge } from "../graph/models/GraphEdge";
import type { BindingEnv } from "./BindingEnv";
import type {
  PatternNode,
  NodePatternNode,
  EdgePatternNode,
  Literal,
} from "../compiler/ast/RuleAST";

export class Matcher {
  /**
   * Finds all binding environments that satisfy the given pattern against
   * the graph, starting from an optional pre-existing binding environment.
   *
   * @param pattern  The PatternNode to match (MATCH or OPTIONAL clause).
   * @param graph    The graph to search.
   * @param seed     Optional existing bindings to extend from (used for OPTIONAL
   *                 when the first node is a back-reference like (api) that is
   *                 already bound from a preceding MATCH clause).
   * @returns        All complete bindings for this pattern, merged into seed.
   */
  match(
    pattern: PatternNode,
    graph: GraphContext,
    seed: BindingEnv = new Map()
  ): BindingEnv[] {
    // Split the linear sequence into [node, edge, node, edge, node, ...]
    const elements = pattern.elements;
    if (elements.length === 0) return [new Map(seed)];

    // Seed with one partial binding per starting node
    let partials: BindingEnv[] = this.expandFirstNode(
      elements[0] as NodePatternNode,
      graph,
      seed
    );

    // Walk the rest of the pattern in edge/node pairs
    let i = 1;
    while (i < elements.length) {
      const edgePat = elements[i] as EdgePatternNode;
      const nodePat = elements[i + 1] as NodePatternNode;
      i += 2;

      const next: BindingEnv[] = [];
      for (const env of partials) {
        // The source node for this edge is the last bound node-pattern alias
        const srcId = this.lastBoundNodeId(env, elements.slice(0, i - 1) as NodePatternNode[]);
        if (!srcId) continue;

        const extended = this.expandEdgeAndNode(srcId, edgePat, nodePat, graph, env);
        next.push(...extended);
      }
      partials = next;
      if (partials.length === 0) return [];
    }

    return partials;
  }

  // ---------------------------------------------------------------------------
  // First node expansion
  // ---------------------------------------------------------------------------

  /**
   * Expands the first NodePattern in the pattern. If the alias is already
   * bound in the seed (back-reference), we use that single node. Otherwise
   * we enumerate all candidate nodes from the graph.
   */
  private expandFirstNode(
    nodePat: NodePatternNode,
    graph: GraphContext,
    seed: BindingEnv
  ): BindingEnv[] {
    // Back-reference: alias already bound in seed (e.g. OPTIONAL (api) -> ...)
    if (nodePat.alias && seed.has(nodePat.alias)) {
      const bound = seed.get(nodePat.alias);
      if (!bound || !("type" in bound)) return []; // not a node
      const node = bound as GraphNode;
      if (!this.nodeMatchesPattern(node, nodePat)) return [];
      return [new Map(seed)]; // seed already has the binding
    }

    // Fresh match: enumerate all candidates
    const candidates = this.getCandidateNodes(nodePat, graph);
    const results: BindingEnv[] = [];

    for (const node of candidates) {
      if (!this.nodeMatchesPattern(node, nodePat)) continue;
      const env = new Map(seed);
      if (nodePat.alias) env.set(nodePat.alias, node);
      results.push(env);
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Edge + next-node expansion
  // ---------------------------------------------------------------------------

  private expandEdgeAndNode(
    srcNodeId: string,
    edgePat: EdgePatternNode,
    nodePat: NodePatternNode,
    graph: GraphContext,
    env: BindingEnv
  ): BindingEnv[] {
    // Depth-1 edge (simple case — covers ~95% of rules)
    if (!edgePat.depth || (edgePat.depth.min === 1 && edgePat.depth.max === 1)) {
      return this.expandSingleHop(srcNodeId, edgePat, nodePat, graph, env);
    }

    // Multi-hop path: BFS from srcNodeId, collecting all reachable nodes within depth range
    return this.expandMultiHop(srcNodeId, edgePat, nodePat, graph, env);
  }

  /**
   * Single-hop match: finds all edges from srcNodeId matching edgePat,
   * then checks if the target satisfies nodePat.
   */
  private expandSingleHop(
    srcNodeId: string,
    edgePat: EdgePatternNode,
    nodePat: NodePatternNode,
    graph: GraphContext,
    env: BindingEnv
  ): BindingEnv[] {
    const results: BindingEnv[] = [];

    const edges = this.getCandidateEdges(srcNodeId, edgePat, graph);

    for (const edge of edges) {
      if (!this.edgeMatchesPattern(edge, edgePat, graph)) continue;

      // Resolve target node — for directed edges it's targetId, for undirected
      // also check if src is the target (bidirectional traversal)
      const targetIds =
        edgePat.direction === "undirected"
          ? [
              edge.targetId === srcNodeId ? edge.sourceId : edge.targetId,
              edge.sourceId === srcNodeId ? edge.targetId : edge.sourceId,
            ].filter((id, idx, arr) => arr.indexOf(id) === idx)
          : [edge.targetId];

      for (const targetId of targetIds) {
        if (targetId === srcNodeId && edgePat.direction !== "undirected") continue;

        const targetNode = graph.getNode(targetId);
        if (!targetNode) continue;

        // Back-reference: alias already bound, must equal this target
        if (nodePat.alias && env.has(nodePat.alias)) {
          const existing = env.get(nodePat.alias);
          if (!existing || !("id" in existing) || (existing as GraphNode).id !== targetId) continue;
          // Additional property check still applies
          if (!this.nodeMatchesPattern(targetNode, nodePat)) continue;
          // Add edge alias if present
          const newEnv = new Map(env);
          if (edgePat.alias) newEnv.set(edgePat.alias, edge);
          results.push(newEnv);
          continue;
        }

        if (!this.nodeMatchesPattern(targetNode, nodePat)) continue;

        const newEnv = new Map(env);
        if (edgePat.alias) newEnv.set(edgePat.alias, edge);
        if (nodePat.alias) newEnv.set(nodePat.alias, targetNode);
        results.push(newEnv);
      }
    }

    return results;
  }

  /**
   * Multi-hop BFS: explores paths of length min..max from srcNodeId.
   * Returns one binding per unique terminal node (not per path).
   * Edge alias is NOT set for multi-hop paths (no single edge to bind to).
   *
   * Spec §15: "min defaults to 1 if unspecified; max defaults to null
   *  (engine cap of 10 applies)."
   */
  private expandMultiHop(
    srcNodeId: string,
    edgePat: EdgePatternNode,
    nodePat: NodePatternNode,
    graph: GraphContext,
    env: BindingEnv
  ): BindingEnv[] {
    const min = edgePat.depth!.min;
    const max = edgePat.depth!.max ?? 10; // engine cap

    // BFS: queue is (nodeId, depth)
    // visited: prevent infinite loops on cycles
    const visited = new Set<string>();
    const queue: { nodeId: string; depth: number }[] = [{ nodeId: srcNodeId, depth: 0 }];
    const results: BindingEnv[] = [];
    const yielded = new Set<string>(); // avoid duplicate result bindings

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (depth > max) continue;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      if (depth >= min && depth <= max && nodeId !== srcNodeId) {
        const node = graph.getNode(nodeId);
        if (node && this.nodeMatchesPattern(node, nodePat) && !yielded.has(nodeId)) {
          yielded.add(nodeId);
          const newEnv = new Map(env);
          if (nodePat.alias) newEnv.set(nodePat.alias, node);
          results.push(newEnv);
        }
      }

      if (depth < max) {
        const outEdges = this.getCandidateEdges(nodeId, edgePat, graph);
        for (const edge of outEdges) {
          if (!this.edgeMatchesPattern(edge, edgePat, graph)) continue;
          const nextId = edgePat.direction === "undirected"
            ? (edge.sourceId === nodeId ? edge.targetId : edge.sourceId)
            : edge.targetId;
          if (!visited.has(nextId)) {
            queue.push({ nodeId: nextId, depth: depth + 1 });
          }
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Candidate retrieval helpers
  // ---------------------------------------------------------------------------

  private getCandidateNodes(
    nodePat: NodePatternNode,
    graph: GraphContext
  ): ReadonlyArray<GraphNode> {
    if (nodePat.type) return graph.getNodesByType(nodePat.type);
    return graph.getNodes();
  }

  private getCandidateEdges(
    srcNodeId: string,
    edgePat: EdgePatternNode,
    graph: GraphContext
  ): ReadonlyArray<GraphEdge> {
    if (edgePat.direction === "undirected") {
      // Undirected: consider both outgoing and incoming edges
      const out = graph.getOutgoingEdges(srcNodeId, edgePat.type ?? undefined);
      const inc = graph.getIncomingEdges(srcNodeId, edgePat.type ?? undefined);
      const all = [...out, ...inc];
      // Deduplicate by id
      const seen = new Set<string>();
      return all.filter((e) => seen.has(e.id) ? false : (seen.add(e.id), true));
    }
    return graph.getOutgoingEdges(srcNodeId, edgePat.type ?? undefined);
  }

  // ---------------------------------------------------------------------------
  // Pattern predicates
  // ---------------------------------------------------------------------------

  nodeMatchesPattern(node: GraphNode, pat: NodePatternNode): boolean {
    // Type constraint
    if (pat.type && node.type !== pat.type) return false;

    // Inline property filters
    for (const [key, litVal] of pat.properties) {
      const nodeVal = node.properties[key];
      if (!this.literalMatches(nodeVal, litVal)) return false;
    }

    return true;
  }

  edgeMatchesPattern(
    edge: GraphEdge,
    pat: EdgePatternNode,
    _graph: GraphContext
  ): boolean {
    // Type constraint (already filtered by getCandidateEdges, but double-check
    // for the anonymous edge case where type was null but we still need property checks)
    if (pat.type && edge.type !== pat.type) return false;

    // Inline property filters
    for (const [key, litVal] of pat.properties) {
      const edgeVal = edge.properties[key];
      if (!this.literalMatches(edgeVal, litVal)) return false;
    }

    return true;
  }

  private literalMatches(
    actual: string | number | boolean | undefined,
    expected: Literal
  ): boolean {
    if (actual === undefined) return false;
    switch (expected.kind) {
      case "string":  return actual === expected.value;
      case "number":  return actual === expected.value;
      case "boolean": return actual === expected.value;
      case "list":    return false; // list comparisons handled by evaluator IN operator
    }
  }

  // ---------------------------------------------------------------------------
  // Utility: find the ID of the most recently bound node in the linear pattern
  // ---------------------------------------------------------------------------

  private lastBoundNodeId(
    env: BindingEnv,
    nodePatterns: NodePatternNode[]
  ): string | null {
    // Walk backwards through node patterns to find the last aliased node
    for (let i = nodePatterns.length - 1; i >= 0; i--) {
      const alias = nodePatterns[i].alias;
      if (alias && env.has(alias)) {
        const val = env.get(alias);
        if (val && "id" in val) return (val as GraphNode).id;
      }
    }
    return null;
  }
}
