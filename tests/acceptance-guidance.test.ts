import { describe, expect, test } from "bun:test"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { AcceptanceService, acceptanceContentHash, materializeLegacyAcceptanceCriteria } from "../src/sdd/acceptance/service.js"
import { analyzeNodeImpact } from "../src/sdd/impact/service.js"
import { analyzeGuidance, applyGuidancePatch, createGuidance } from "../src/sdd/guidance/service.js"
import type { AnyNode } from "../src/sdd/domain/types.js"

function node(id: string, type: AnyNode["type"], name: string, metadata: Record<string, unknown> = {}): AnyNode {
  const now = new Date().toISOString()
  return { id, type, name, status: "DRAFT", version: 1, metadata, created_at: now, updated_at: now } as AnyNode
}

function baseGraph() {
  const graph = createGraph("project")
  addNode(graph, node("project", "project", "Project"))
  addNode(graph, node("REQ-1", "requirement", "Login", { acceptance_criteria: ["User can sign in"] }))
  addNode(graph, node("FEAT-1", "feature", "Auth"))
  addNode(graph, node("TASK-1", "task", "Implement auth"))
  addRelationship(graph, "REQ-1", "FEAT-1", "specifies")
  addRelationship(graph, "TASK-1", "REQ-1", "implements")
  return graph
}

describe("acceptance service", () => {
  test("creates, accepts, reopens and hashes criteria", () => {
    const graph = baseGraph()
    const service = new AcceptanceService(graph)
    const criterion = service.create("REQ-1", "User can sign in")
    expect(criterion.status).toBe("PENDING")
    expect(criterion.metadata.content_hash).toBe(acceptanceContentHash("User can sign in"))
    const accepted = service.accept(criterion.id, { actor: "alice" })
    expect(accepted.criterion.status).toBe("ACCEPTED")
    expect(accepted.criterion.metadata.accepted_by).toBe("alice")
    const reopened = service.reopen(criterion.id, { actor: "alice" })
    expect(reopened.criterion.status).toBe("PENDING")
  })

  test("accept all preflights version conflicts without partial mutation", () => {
    const graph = baseGraph()
    const service = new AcceptanceService(graph)
    service.create("REQ-1", "User can sign in")
    service.create("REQ-1", "User receives a session")
    const result = service.acceptAll("REQ-1", { actor: "alice", expected_version: 99 })
    expect(result.accepted).toHaveLength(0)
    expect(result.failed.length).toBeGreaterThan(0)
    expect(service.summary("REQ-1", false).accepted).toBe(0)
  })

  test("materializes legacy criteria idempotently", () => {
    const graph = baseGraph()
    const first = materializeLegacyAcceptanceCriteria(graph)
    const second = materializeLegacyAcceptanceCriteria(graph)
    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(graph.relationships.filter((rel) => rel.type === "has_acceptance_criterion")).toHaveLength(1)
  })
})

describe("generic impact and guidance", () => {
  test("finds incoming and outgoing affected nodes", () => {
    const graph = baseGraph()
    const impact = analyzeNodeImpact(graph, "REQ-1")
    expect(impact.direct.map((item) => item.node.id)).toEqual(expect.arrayContaining(["FEAT-1", "TASK-1"]))
  })

  test("guidance can target any node and apply a versioned patch", () => {
    const graph = baseGraph()
    const guidance = createGuidance(graph, "FEAT-1", { instruction: "Rename the feature", requested_by: "alice" })
    const analysis = analyzeGuidance(graph, guidance.id)
    expect(analysis.impact.source.id).toBe("FEAT-1")
    const applied = applyGuidancePatch(graph, guidance.id, { name: "Authentication" }, "alice", 1)
    expect(applied.target.name).toBe("Authentication")
    expect(applied.target.version).toBe(2)
    expect(applied.guidance.metadata.status).toBe("APPLIED")
  })

  test("guidance propagates only to nodes identified by impact analysis", () => {
    const graph = baseGraph()
    const guidance = createGuidance(graph, "FEAT-1", { instruction: "Rename feature and align requirement", requested_by: "alice" })
    analyzeGuidance(graph, guidance.id)
    const applied = applyGuidancePatch(graph, guidance.id, {
      name: "Authentication",
      updates: [{ node_id: "REQ-1", patch: { description: "Authentication behavior" }, expected_version: 1 }],
    }, "alice", 1)
    expect(applied.target.name).toBe("Authentication")
    expect(graph.nodes.find((candidate) => candidate.id === "REQ-1")?.description).toBe("Authentication behavior")
    expect(applied.guidance.metadata.applied_target_ids).toEqual(expect.arrayContaining(["FEAT-1", "REQ-1"]))
  })
})
