import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { createGraph, addNode, getNode, addRelationship, getNeighbors, getGraphStats, updateNode, removeNode } from "../src/sdd/graph/engine.js"
import { bfsOutgoing, bfsIncoming, computeImpact, findPath, getSubgraph } from "../src/sdd/graph/traverse.js"
import type { KnowledgeGraph, AnyNode } from "../src/sdd/domain/types.js"

function makeNode(id: string, type: string = "feature"): AnyNode {
  return {
    id,
    type: type as AnyNode["type"],
    name: `Node ${id}`,
    status: "DRAFT",
    version: 1,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as AnyNode
}

describe("Graph Engine", () => {
  let graph: KnowledgeGraph

  beforeEach(() => {
    graph = createGraph("test-project")
    graph.project_id = "test-project"
  })

  test("createGraph initializes empty graph", () => {
    expect(graph.nodes).toHaveLength(0)
    expect(graph.relationships).toHaveLength(0)
    expect(graph.project_id).toBe("test-project")
  })

  test("addNode adds a node", () => {
    const node = makeNode("TEST-001")
    addNode(graph, node)
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0].id).toBe("TEST-001")
  })

  test("addNode rejects duplicate IDs", () => {
    addNode(graph, makeNode("TEST-001"))
    expect(() => addNode(graph, makeNode("TEST-001"))).toThrow("already exists")
  })

  test("getNode retrieves a node", () => {
    addNode(graph, makeNode("TEST-001"))
    const found = getNode(graph, "TEST-001")
    expect(found).toBeDefined()
    expect(found!.id).toBe("TEST-001")
  })

  test("getNode returns undefined for missing", () => {
    expect(getNode(graph, "MISSING")).toBeUndefined()
  })

  test("updateNode modifies a node", () => {
    addNode(graph, makeNode("TEST-001"))
    updateNode(graph, "TEST-001", { name: "Updated" })
    const node = getNode(graph, "TEST-001")
    expect(node!.name).toBe("Updated")
    expect(node!.version).toBe(2)
  })

  test("removeNode removes a node and its relationships", () => {
    addNode(graph, makeNode("TEST-001"))
    addNode(graph, makeNode("TEST-002"))
    addRelationship(graph, "TEST-001", "TEST-002", "depends_on")
    removeNode(graph, "TEST-001")
    expect(graph.nodes).toHaveLength(1)
    expect(graph.relationships).toHaveLength(0)
  })

  test("addRelationship creates edges", () => {
    addNode(graph, makeNode("TEST-001"))
    addNode(graph, makeNode("TEST-002"))
    const rel = addRelationship(graph, "TEST-001", "TEST-002", "depends_on")
    expect(graph.relationships).toHaveLength(1)
    expect(rel.from).toBe("TEST-001")
    expect(rel.to).toBe("TEST-002")
  })

  test("addRelationship rejects missing nodes", () => {
    expect(() => addRelationship(graph, "A", "B", "depends_on")).toThrow("not found")
  })

  test("getNeighbors finds connected nodes", () => {
    addNode(graph, makeNode("A"))
    addNode(graph, makeNode("B"))
    addNode(graph, makeNode("C"))
    addRelationship(graph, "A", "B", "contains")
    addRelationship(graph, "C", "A", "depends_on")

    const neighbors = getNeighbors(graph, "A")
    expect(neighbors).toHaveLength(2)
  })

  test("getGraphStats returns correct counts", () => {
    addNode(graph, makeNode("A", "feature"))
    addNode(graph, makeNode("B", "requirement"))
    addRelationship(graph, "A", "B", "satisfies")

    const stats = getGraphStats(graph)
    expect(stats.total_nodes).toBe(2)
    expect(stats.total_relationships).toBe(1)
    expect(stats.by_type["feature"]).toBe(1)
    expect(stats.by_type["requirement"]).toBe(1)
  })
})

describe("Graph Traversal", () => {
  let graph: KnowledgeGraph

  beforeEach(() => {
    graph = createGraph("test")
    addNode(graph, makeNode("A"))
    addNode(graph, makeNode("B"))
    addNode(graph, makeNode("C"))
    addNode(graph, makeNode("D"))
    addNode(graph, makeNode("E"))
    addRelationship(graph, "A", "B", "contains")
    addRelationship(graph, "A", "C", "contains")
    addRelationship(graph, "B", "D", "depends_on")
    addRelationship(graph, "C", "D", "depends_on")
    addRelationship(graph, "D", "E", "implements")
  })

  test("bfsOutgoing finds all downstream nodes", () => {
    const result = bfsOutgoing(graph, "A", { include_start: false })
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["B", "C", "D", "E"])
  })

  test("bfsIncoming finds all upstream nodes", () => {
    const result = bfsIncoming(graph, "D", { include_start: false })
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"])
  })

  test("computeImpact categorizes direct vs indirect", () => {
    const impact = computeImpact(graph, "A", 5)
    expect(impact.direct.map((n) => n.id).sort()).toEqual(["B", "C"])
    expect(impact.indirect.map((n) => n.id)).toContain("D")
  })

  test("findPath finds path between nodes", () => {
    const path = findPath(graph, "A", "E")
    expect(path).not.toBeNull()
    expect(path!.map((n) => n.id)).toEqual(["A", "B", "D", "E"])
  })

  test("findPath returns null for unreachable", () => {
    addNode(graph, makeNode("Z"))
    const path = findPath(graph, "A", "Z")
    expect(path).toBeNull()
  })

  test("getSubgraph returns filtered graph", () => {
    const sub = getSubgraph(graph, ["A", "B", "D"])
    expect(sub.nodes).toHaveLength(3)
    expect(sub.relationships.length).toBeLessThan(graph.relationships.length)
  })
})

describe("bfsBoth", () => {
  test("traverses in both directions", () => {
    const g = createGraph("test")
    addNode(g, makeNode("A"))
    addNode(g, makeNode("B"))
    addNode(g, makeNode("C"))
    addRelationship(g, "A", "B", "contains")
    addRelationship(g, "C", "B", "depends_on")

    const result = bfsOutgoing(g, "A", { include_start: false })
    expect(result.nodes.map((n) => n.id)).toEqual(["B"])

    const incoming = bfsIncoming(g, "B", { include_start: false })
    expect(incoming.nodes.map((n) => n.id).sort()).toEqual(["A", "C"])
  })
})

describe("max_depth", () => {
  test("respects max depth limit", () => {
    const g = createGraph("test")
    addNode(g, makeNode("A"))
    addNode(g, makeNode("B"))
    addNode(g, makeNode("C"))
    addRelationship(g, "A", "B", "contains")
    addRelationship(g, "B", "C", "contains")

    const result = bfsOutgoing(g, "A", { max_depth: 1, include_start: false })
    expect(result.nodes.map((n) => n.id)).toEqual(["B"])
  })
})
