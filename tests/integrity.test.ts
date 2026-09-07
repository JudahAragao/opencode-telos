import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { GraphIndices } from "../src/sdd/graph/index.js"
import { computeGraphChecksum, validateGraphIntegrity, recordLegitimateSave } from "../src/sdd/graph/integrity-guard.js"

function makeGraph() {
  const graph = createGraph("integrity-test")
  addNode(graph, { id: "R1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: { description: "User login" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  addNode(graph, { id: "E1", type: "entity", name: "User", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  addRelationship(graph, "R1", "E1", "depends_on")
  return graph
}

describe("GraphIndices immutability", () => {
  test("byId returns cloned nodes", () => {
    const graph = makeGraph()
    const indices = GraphIndices.from(graph)
    const byId = indices.byId
    const node = byId.get("R1")!
    expect(node).toBeDefined()
    // Mutating the returned node should not affect internal state
    node.name = "MUTATED"
    const byId2 = indices.byId
    expect(byId2.get("R1")!.name).toBe("Login")
  })

  test("byType returns cloned arrays", () => {
    const graph = makeGraph()
    const indices = GraphIndices.from(graph)
    const reqs = indices.byType.get("requirement")!
    expect(reqs.length).toBe(1)
    // Pushing to the returned array should not affect internal state
    ;(reqs as any[]).push({ id: "fake" })
    const reqs2 = indices.byType.get("requirement")!
    expect(reqs2.length).toBe(1)
  })

  test("getNode returns cloned node", () => {
    const graph = makeGraph()
    const indices = GraphIndices.from(graph)
    const node = indices.getNode("R1")!
    node.name = "MUTATED"
    const node2 = indices.getNode("R1")!
    expect(node2.name).toBe("Login")
  })

  test("getNodesByType returns cloned array", () => {
    const graph = makeGraph()
    const indices = GraphIndices.from(graph)
    const reqs = indices.getNodesByType("requirement")
    reqs.push({ id: "fake" } as any)
    const reqs2 = indices.getNodesByType("requirement")
    expect(reqs2.length).toBe(1)
  })

  test("getOutgoing returns cloned relationships", () => {
    const graph = makeGraph()
    const indices = GraphIndices.from(graph)
    const rels = indices.getOutgoing("R1")
    rels.push({ id: "fake" } as any)
    const rels2 = indices.getOutgoing("R1")
    expect(rels2.length).toBe(1)
  })

  test("getNeighborIds returns cloned set", () => {
    const graph = makeGraph()
    const indices = GraphIndices.from(graph)
    const neighbors = indices.getNeighborIds("R1")
    neighbors.add("fake")
    const neighbors2 = indices.getNeighborIds("R1")
    expect(neighbors2.has("fake")).toBe(false)
  })

  test("totalNodes count is correct", () => {
    const graph = makeGraph()
    const indices = GraphIndices.from(graph)
    expect(indices.totalNodes).toBe(2)
    expect(indices.totalRelationships).toBe(1)
  })
})

describe("computeGraphChecksum", () => {
  test("same graph produces same checksum", () => {
    const graph = makeGraph()
    const c1 = computeGraphChecksum(graph)
    const c2 = computeGraphChecksum(graph)
    expect(c1).toBe(c2)
  })

  test("different graphs produce different checksums", () => {
    const g1 = makeGraph()
    const g2 = makeGraph()
    addNode(g2, { id: "R2", type: "requirement", name: "Logout", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    expect(computeGraphChecksum(g1)).not.toBe(computeGraphChecksum(g2))
  })

  test("content changes produce different checksums with same node count", () => {
    const g1 = makeGraph()
    const g2 = makeGraph()
    g2.nodes[0].name = "Different Name"
    expect(computeGraphChecksum(g1)).not.toBe(computeGraphChecksum(g2))
  })
})

describe("validateGraphIntegrity", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "integrity-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("first save is accepted as legitimate", () => {
    const graph = makeGraph()
    const result = validateGraphIntegrity(dir, graph)
    expect(result.valid).toBe(true)
    expect(result.tampered).toBe(false)
  })

  test("corrupt integrity file is handled gracefully", () => {
    const { writeFileSync } = require("fs")
    writeFileSync(join(dir, ".sdd", "integrity.json"), "not-valid-json{{{", "utf-8")
    const graph = makeGraph()
    const result = validateGraphIntegrity(dir, graph)
    // Corrupt file is either flagged tampered or treated as first save
    expect(typeof result.tampered).toBe("boolean")
  })

  test("recognized checksum is considered legitimate", () => {
    const graph = makeGraph()
    recordLegitimateSave(dir, graph)
    const result = validateGraphIntegrity(dir, graph)
    expect(result.valid).toBe(true)
    expect(result.tampered).toBe(false)
  })
})
