import { describe, it, expect } from "vitest";
import { validateAndNormaliseGraph } from "./graphValidator";

describe("graphValidator", () => {
  it("Constraint 10: accepts an empty graph", () => {
    const result = validateAndNormaliseGraph([], []);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
    }
  });

  it("Constraint 1 & 2: requires nodes and edges to be arrays", () => {
    const res1 = validateAndNormaliseGraph(null, []);
    expect(res1.success).toBe(false);
    if (!res1.success) {
      expect(res1.errors).toContainEqual({
        field: "nodes",
        issue: "nodes must be an array",
      });
    }

    const res2 = validateAndNormaliseGraph([], {});
    expect(res2.success).toBe(false);
    if (!res2.success) {
      expect(res2.errors).toContainEqual({
        field: "edges",
        issue: "edges must be an array",
      });
    }
  });

  it("Constraint 3: detects duplicate node ids", () => {
    const nodes = [
      { id: "n1", type: "Server" },
      { id: "n1", type: "Database" },
    ];
    const result = validateAndNormaliseGraph(nodes, []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual({
        field: "nodes[1].id",
        issue: "Duplicate node id 'n1'",
        value: "n1",
      });
    }
  });

  it("Constraint 4: detects duplicate edge ids", () => {
    const nodes = [
      { id: "n1", type: "Server" },
      { id: "n2", type: "Server" },
    ];
    const edges = [
      { id: "e1", sourceId: "n1", targetId: "n2" },
      { id: "e1", sourceId: "n2", targetId: "n1" },
    ];
    const result = validateAndNormaliseGraph(nodes, edges);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual({
        field: "edges[1].id",
        issue: "Duplicate edge id 'e1'",
        value: "e1",
      });
    }
  });

  it("Constraint 5 & 6: enforces referential integrity for sourceId and targetId", () => {
    const nodes = [{ id: "n1", type: "Server" }];
    const edges = [{ id: "e1", sourceId: "missing1", targetId: "missing2" }];
    const result = validateAndNormaliseGraph(nodes, edges);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual({
        field: "edges[0].sourceId",
        issue: "Source node 'missing1' does not exist in the nodes array",
        value: "missing1",
      });
      expect(result.errors).toContainEqual({
        field: "edges[0].targetId",
        issue: "Target node 'missing2' does not exist in the nodes array",
        value: "missing2",
      });
    }
  });

  it("Constraint 7: allows self-loops", () => {
    const nodes = [{ id: "n1", type: "Server" }];
    const edges = [{ id: "e1", sourceId: "n1", targetId: "n1" }];
    const result = validateAndNormaliseGraph(nodes, edges);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.edges[0].sourceId).toBe("n1");
      expect(result.edges[0].targetId).toBe("n1");
    }
  });

  it("Constraint 8: rejects invalid node types", () => {
    const nodes = [{ id: "n1", type: "FakeType" }];
    const result = validateAndNormaliseGraph(nodes, []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0].field).toBe("nodes[0].type");
      expect(result.errors[0].issue).toMatch(/Unknown node type/);
    }
  });

  it("Constraint 9: validates edge type and defaults to Traffic", () => {
    const nodes = [
      { id: "n1", type: "Server" },
      { id: "n2", type: "Server" },
    ];
    const edges = [
      { id: "e1", sourceId: "n1", targetId: "n2" }, // no type, should default
      { id: "e2", type: "InvalidEdge", sourceId: "n1", targetId: "n2" },
      { id: "e3", type: "Reads", sourceId: "n1", targetId: "n2" },
    ];
    
    const result = validateAndNormaliseGraph(nodes, edges);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "edges[1].type",
          issue: expect.stringMatching(/Unknown edge type/),
        })
      );
    }

    // Now test success case for defaulting
    const validEdges = [
      { id: "e1", sourceId: "n1", targetId: "n2" },
      { id: "e3", type: "Reads", sourceId: "n1", targetId: "n2" },
    ];
    const successResult = validateAndNormaliseGraph(nodes, validEdges);
    expect(successResult.success).toBe(true);
    if (successResult.success) {
      expect(successResult.edges[0].type).toBe("Traffic");
      expect(successResult.edges[1].type).toBe("Reads");
    }
  });

  it("normalises node labels and properties", () => {
    const nodes = [
      { id: "n1", type: "Server" }, // no label, no properties
      { id: "n2", type: "Database", label: "Main DB", properties: { public: true } },
    ];
    const result = validateAndNormaliseGraph(nodes, []);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.nodes[0].label).toBe("Server");
      expect(result.nodes[0].properties).toEqual({});
      
      expect(result.nodes[1].label).toBe("Main DB");
      expect(result.nodes[1].properties).toEqual({ public: true });
    }
  });

  it("rejects invalid property types", () => {
    const nodes = [
      { 
        id: "n1", 
        type: "Server", 
        properties: { 
          validString: "str",
          validNumber: 42,
          validBool: false,
          invalidObj: {},
          invalidArr: []
        } 
      }
    ];
    const result = validateAndNormaliseGraph(nodes, []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBe(2);
      expect(result.errors.map(e => e.field)).toContain("nodes[0].properties.invalidObj");
      expect(result.errors.map(e => e.field)).toContain("nodes[0].properties.invalidArr");
    }
  });
  
  it("rejects properties that are not objects", () => {
    const nodes = [
      { id: "n1", type: "Server", properties: "invalid string" }
    ];
    const result = validateAndNormaliseGraph(nodes, []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: "nodes[0].properties",
          issue: "properties must be a plain object",
        })
      );
    }
  });
});
