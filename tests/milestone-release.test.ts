import { describe, test, expect, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import {
  createMilestone,
  getMilestoneNodes,
  linkNodesToMilestone,
  unlinkNodesFromMilestone,
  moveNodesToMilestone,
  closeMilestone,
  buildReleaseReport,
  formatReleaseReport,
} from "../src/sdd/release/milestone.js"
import { YamlGraphRepository } from "../src/sdd/persistence/yaml.js"
import { createSddTools } from "../src/opencode/tools.js"
import type { AnyNode, KnowledgeGraph } from "../src/sdd/domain/types.js"

function node(id: string, type: string, name: string, metadata: Record<string, unknown> = {}, status = "DRAFT"): AnyNode {
  return {
    id,
    type: type as AnyNode["type"],
    name,
    status: status as AnyNode["status"],
    version: 1,
    metadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as AnyNode
}

function seedReleaseGraph(): KnowledgeGraph {
  const graph = createGraph("rel")
  addNode(graph, node("rel", "project", "Rel"))
  addNode(graph, node("FEAT-1", "feature", "Checkout"))
  addNode(graph, node("FEAT-2", "feature", "Unlinked feature"))
  addNode(graph, node("REQ-1", "requirement", "Checkout accepts card"))
  addNode(graph, node("REQ-2", "requirement", "Checkout is fast"))
  addNode(graph, node("EP-1", "endpoint", "POST /checkout", { method: "POST", path: "/checkout" }))
  addNode(graph, node("TEST-1", "test", "checkout.spec.ts"))
  addNode(graph, node("CHG-1", "change", "Add checkout", { affected_files: [] }))
  addNode(graph, node("TASK-1", "task", "Implement checkout", {}, "completed"))

  addRelationship(graph, "REQ-1", "FEAT-1", "specifies")
  addRelationship(graph, "REQ-2", "FEAT-1", "specifies")
  addRelationship(graph, "EP-1", "FEAT-1", "implements")
  addRelationship(graph, "REQ-1", "TEST-1", "tested_by")
  addRelationship(graph, "CHG-1", "FEAT-1", "affects")
  return graph
}

describe("milestone service", () => {
  let graph: KnowledgeGraph

  beforeEach(() => {
    graph = seedReleaseGraph()
  })

  test("creates a milestone linked to the project", () => {
    const milestone = createMilestone(graph, { name: "Release 1.0", release_version: "1.0" })
    expect(milestone.id).toBe("MILESTONE-release-1-0")
    expect(getMilestoneNodes(graph).length).toBe(1)
    expect(graph.relationships.some((r) => r.from === "rel" && r.to === milestone.id && r.type === "contains")).toBe(true)
  })

  test("rejects duplicate names", () => {
    createMilestone(graph, { name: "Release 1.0" })
    expect(() => createMilestone(graph, { name: "release 1.0" })).toThrow("already exists")
  })

  test("links members and mirrors change_ids", () => {
    const milestone = createMilestone(graph, { name: "Release 1.0" })
    const result = linkNodesToMilestone(graph, milestone.id, ["CHG-1", "TASK-1", "FEAT-2", "MISSING"])
    expect(result.linked).toBe(3)
    expect(result.not_found).toContain("MISSING")
    const after = getMilestoneNodes(graph)[0]
    expect(after.metadata.change_ids).toEqual(expect.arrayContaining(["CHG-1", "TASK-1"]))
  })

  test("unlink and move between milestones", () => {
    const a = createMilestone(graph, { name: "Release 1.0" })
    const b = createMilestone(graph, { name: "Release 2.0" })
    linkNodesToMilestone(graph, a.id, ["CHG-1"])
    moveNodesToMilestone(graph, a.id, b.id, ["CHG-1"])
    expect(graph.relationships.some((r) => r.from === b.id && r.to === "CHG-1" && r.type === "contains")).toBe(true)
    expect(unlinkNodesFromMilestone(graph, b.id, ["CHG-1"])).toBe(1)
  })

  test("closes a milestone", () => {
    const milestone = createMilestone(graph, { name: "Release 1.0" })
    const closed = closeMilestone(graph, milestone.id)
    expect(closed.status).toBe("COMPLETED")
    expect(closed.metadata.closed_at).toBeTruthy()
  })
})

describe("release traceability report", () => {
  test("computes scope, progress and gaps", () => {
    const graph = seedReleaseGraph()
    const milestone = createMilestone(graph, { name: "Release 1.0", release_version: "1.0" })
    linkNodesToMilestone(graph, milestone.id, ["CHG-1", "TASK-1", "FEAT-2"])

    const report = buildReleaseReport(graph, milestone.id)
    expect(report.milestones.length).toBe(1)
    const m = report.milestones[0]

    // Escopo: change/task diretos + feature afetada + requisitos + endpoint + teste
    expect(m.counts.changes).toBe(1)
    expect(m.counts.tasks).toBe(1)
    expect(m.counts.features).toBe(2)
    expect(m.counts.requirements).toBe(2)
    expect(m.counts.endpoints).toBe(1)
    expect(m.counts.tests).toBe(1)
    expect(m.progress_percent).toBe(100)

    // Cobertura / gaps
    expect(m.coverage.requirements_total).toBe(2)
    expect(m.coverage.requirements_tested).toBe(1)
    expect(m.coverage.requirements_untested).toContain("REQ-2")
    expect(m.coverage.features_linked).toBe(1)
    expect(m.coverage.features_unlinked).toContain("FEAT-2")
    expect(m.coverage.endpoints_unlinked).toEqual([])
  })

  test("reports unassigned changes and tasks", () => {
    const graph = seedReleaseGraph()
    const milestone = createMilestone(graph, { name: "Release 1.0" })
    linkNodesToMilestone(graph, milestone.id, ["CHG-1"])

    const report = buildReleaseReport(graph)
    expect(report.unassigned.tasks).toContain("TASK-1")
    expect(report.unassigned.changes).not.toContain("CHG-1")
  })

  test("formats a readable report", () => {
    const graph = seedReleaseGraph()
    const milestone = createMilestone(graph, { name: "Release 1.0", release_version: "1.0" })
    linkNodesToMilestone(graph, milestone.id, ["CHG-1"])
    const text = formatReleaseReport(buildReleaseReport(graph), (id) => graph.nodes.find((n) => n.id === id)?.name ?? id)
    expect(text).toContain("Per-release Traceability")
    expect(text).toContain("Release 1.0")
    expect(text).toContain("Gaps de rastreabilidade")
  })
})

describe("sdd.milestone tool", () => {
  function setupYaml(): string {
    const dir = mkdtempSync(join(tmpdir(), "milestone-tool-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
    const repo = new YamlGraphRepository(dir)
    const graph = seedReleaseGraph()
    repo.saveGraph(graph)
    return dir
  }

  test("create, add members and report", async () => {
    const dir = setupYaml()
    try {
      const tools = createSddTools()
      const ctx = { directory: dir, sessionID: "test-session" }

      const created = (await (tools["sdd.milestone"] as any).execute(
        { action: "create", name: "Release 1.0", release_version: "1.0" },
        ctx,
      )) as string
      expect(created).toContain("MILESTONE-release-1-0")

      const added = (await (tools["sdd.milestone"] as any).execute(
        { action: "add", milestone_id: "MILESTONE-release-1-0", node_ids: "CHG-1,FEAT-2" },
        ctx,
      )) as string
      expect(added).toContain("**Vinculados:** 2")

      const report = (await (tools["sdd.milestone"] as any).execute(
        { action: "report", milestone_id: "MILESTONE-release-1-0" },
        ctx,
      )) as string
      expect(report).toContain("Release 1.0")
      expect(report).toContain("Unlinked feature")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("list without milestones is informative", async () => {
    const dir = mkdtempSync(join(tmpdir(), "milestone-empty-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
    new YamlGraphRepository(dir).saveGraph(seedReleaseGraph())
    try {
      const tools = createSddTools()
      const listed = (await (tools["sdd.milestone"] as any).execute({ action: "list" }, { directory: dir, sessionID: "s" })) as string
      expect(listed).toContain("No milestone")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
