import { describe, test, expect, beforeEach } from "bun:test"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import {
  getInverseRelationshipType,
  isRelationshipAllowed,
  isTraceabilityRelationship,
  relationshipKey,
} from "../src/sdd/graph/schema.js"
import {
  inferRelationships,
  applyInferredRelationships,
  normalizeInverseRelationships,
  ensureMilestoneNodes,
  runRelationshipInference,
} from "../src/sdd/discovery/relationship-inferencer.js"
import type { AnyNode, KnowledgeGraph } from "../src/sdd/domain/types.js"

function node(id: string, type: string, name: string, metadata: Record<string, unknown> = {}): AnyNode {
  return {
    id,
    type: type as AnyNode["type"],
    name,
    status: "DRAFT",
    version: 1,
    metadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as AnyNode
}

function hasEdge(graph: KnowledgeGraph, from: string, to: string, type: string): boolean {
  return graph.relationships.some((r) => r.from === from && r.to === to && r.type === type)
}

describe("Relationship schema", () => {
  test("maps inverse relationship types", () => {
    expect(getInverseRelationshipType("specifies")).toBe("satisfied_by")
    expect(getInverseRelationshipType("implements")).toBe("implemented_by")
    expect(getInverseRelationshipType("tested_by")).toBe("tests")
    expect(getInverseRelationshipType("contains")).toBe("belongs_to")
  })

  test("validates allowed combinations", () => {
    expect(isRelationshipAllowed("requirement", "specifies", "feature")).toBe(true)
    expect(isRelationshipAllowed("endpoint", "operates_on", "entity")).toBe(true)
    expect(isRelationshipAllowed("feature", "operates_on", "entity")).toBe(false)
  })

  test("classifies traceability edges", () => {
    expect(isTraceabilityRelationship("implements")).toBe(true)
    expect(isTraceabilityRelationship("specifies")).toBe(true)
    expect(isTraceabilityRelationship("traces_to")).toBe(false)
    expect(isTraceabilityRelationship("contains")).toBe(false)
  })
})

describe("Relationship inference", () => {
  let graph: KnowledgeGraph

  beforeEach(() => {
    graph = createGraph("proj")
    addNode(graph, node("proj", "project", "Proj"))
    addNode(graph, node("FEAT-1", "feature", "2FA Authentication"))
    addNode(graph, node("REQ-1", "requirement", "2FA enforcement"))
    addNode(graph, node("ENT-1", "entity", "ApiKey"))
  })

  test("infers requirement --specifies--> feature", () => {
    const proposals = inferRelationships(graph)
    const spec = proposals.find((p) => p.type === "specifies" && p.from === "REQ-1" && p.to === "FEAT-1")
    expect(spec).toBeDefined()
    expect(spec!.confidence).toBeGreaterThanOrEqual(0.5)
  })

  test("infers endpoint --implements--> feature and --operates_on--> entity", () => {
    addNode(graph, node("EP-1", "endpoint", "POST /api/auth/2fa/setup", { method: "POST", path: "/api/auth/2fa/setup" }))
    addNode(graph, node("EP-2", "endpoint", "GET /api/api-keys", { method: "GET", path: "/api/api-keys" }))

    const proposals = inferRelationships(graph)
    expect(proposals.some((p) => p.type === "implements" && p.from === "EP-1" && p.to === "FEAT-1")).toBe(true)
    expect(proposals.some((p) => p.type === "operates_on" && p.from === "EP-2" && p.to === "ENT-1")).toBe(true)
  })

  test("infers file --implements--> feature from path", () => {
    addNode(graph, node("file:okx", "file", "src/providers/okx.provider.ts", { path: "src/providers/okx.provider.ts" }))
    addNode(graph, node("FEAT-2", "feature", "OKX Integration"))
    const proposals = inferRelationships(graph)
    expect(proposals.some((p) => p.type === "implements" && p.from === "file:okx" && p.to === "FEAT-2")).toBe(true)
  })

  test("applies proposals idempotently", () => {
    const proposals = inferRelationships(graph)
    const first = applyInferredRelationships(graph, proposals)
    expect(first.applied).toBeGreaterThan(0)

    const relationshipsAfterFirst = graph.relationships.length
    const secondProposals = inferRelationships(graph)
    const second = applyInferredRelationships(graph, secondProposals)
    expect(second.applied).toBe(0)
    expect(graph.relationships.length).toBe(relationshipsAfterFirst)
  })
})

describe("Inverse normalization", () => {
  test("removes satisfied_by when specifies exists", () => {
    const graph = createGraph("proj")
    addNode(graph, node("proj", "project", "Proj"))
    addNode(graph, node("FEAT-1", "feature", "Auth"))
    addNode(graph, node("REQ-1", "requirement", "Auth"))
    // Grafo legado: par inverso criado fora do engine (por isso sem checagem de ciclo).
    graph.relationships.push(
      { id: "REL-spec", from: "REQ-1", to: "FEAT-1", type: "specifies", metadata: {} },
      { id: "REL-sat", from: "FEAT-1", to: "REQ-1", type: "satisfied_by", metadata: {} },
    )

    const removed = normalizeInverseRelationships(graph)
    expect(removed).toBe(1)
    expect(hasEdge(graph, "REQ-1", "FEAT-1", "specifies")).toBe(true)
    expect(hasEdge(graph, "FEAT-1", "REQ-1", "satisfied_by")).toBe(false)
    expect(relationshipKey("REQ-1", "FEAT-1", "specifies").length).toBeGreaterThan(0)
  })
})

describe("Milestones", () => {
  test("creates milestone node from task metadata and links it", () => {
    const graph = createGraph("proj")
    addNode(graph, node("proj", "project", "Proj"))
    addNode(graph, node("TASK-1", "task", "Ship 2FA", { milestone: "Release 1.0" }))

    const created = ensureMilestoneNodes(graph)
    expect(created).toBe(1)
    const milestone = graph.nodes.find((n) => n.type === "milestone")
    expect(milestone).toBeDefined()
    expect(hasEdge(graph, "TASK-1", milestone!.id, "belongs_to")).toBe(true)
  })
})

describe("runRelationshipInference", () => {
  test("reports applied edges and is stable on re-run", () => {
    const graph = createGraph("proj")
    addNode(graph, node("proj", "project", "Proj"))
    addNode(graph, node("FEAT-1", "feature", "2FA Authentication"))
    addNode(graph, node("REQ-1", "requirement", "2FA enforcement"))
    addNode(graph, node("EP-1", "endpoint", "POST /api/auth/2fa/setup", { method: "POST", path: "/api/auth/2fa/setup" }))

    const first = runRelationshipInference(graph)
    expect(first.applied).toBeGreaterThan(0)
    expect(first.by_type["specifies"] ?? 0).toBeGreaterThan(0)

    const edgesAfterFirst = graph.relationships.length
    const second = runRelationshipInference(graph)
    expect(second.applied).toBe(0)
    expect(graph.relationships.length).toBe(edgesAfterFirst)
  })
})
