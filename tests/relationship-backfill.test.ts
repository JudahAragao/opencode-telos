import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode } from "../src/sdd/graph/engine.js"
import { YamlGraphRepository } from "../src/sdd/persistence/yaml.js"
import { createRepository } from "../src/sdd/persistence/repository.js"
import { runMigrations, hasPendingMigrations } from "../src/sdd/migrations/index.js"
import type { AnyNode } from "../src/sdd/domain/types.js"

const BACKFILL_ID = "20260922_backfill_relationship_traceability"

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

/** Grafo legado: nós existem, mas as arestas semânticas estão ausentes. */
function writeLegacyGraph(dir: string): void {
  const graph = createGraph("legacy")
  addNode(graph, node("legacy", "project", "Legacy"))
  addNode(graph, node("FEAT-1", "feature", "2FA Authentication"))
  addNode(graph, node("FEAT-2", "feature", "OKX Integration"))
  addNode(graph, node("REQ-1", "requirement", "2FA enforcement"))
  addNode(graph, node("ENT-1", "entity", "ApiKey"))
  addNode(graph, node("EP-1", "endpoint", "POST /api/auth/2fa/setup", { method: "POST", path: "/api/auth/2fa/setup" }))
  addNode(graph, node("EP-2", "endpoint", "GET /api/api-keys", { method: "GET", path: "/api/api-keys" }))
  addNode(graph, node("file:okx", "file", "src/providers/okx.provider.ts", { path: "src/providers/okx.provider.ts" }))
  addNode(graph, node("TASK-1", "task", "Ship 2FA", { milestone: "Release 1.0" }))
  // Nenhuma aresta — exatamente o estado que a migração precisa reparar.
  const repo = new YamlGraphRepository(dir)
  repo.saveGraph(graph)
}

function hasEdge(graph: { relationships: Array<{ from: string; to: string; type: string }> }, from: string, to: string, type: string): boolean {
  return graph.relationships.some((r) => r.from === from && r.to === to && r.type === type)
}

describe("Relationship traceability backfill migration", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rel-backfill-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("is registered as a pending migration", () => {
    writeLegacyGraph(dir)
    expect(hasPendingMigrations(dir)).toBe(true)
  })

  test("reconstructs the traceability edges on an existing graph", () => {
    writeLegacyGraph(dir)

    const results = runMigrations(dir)
    expect(results.some((r) => r.success)).toBe(true)

    const graph = createRepository(dir).loadGraph()
    expect(hasEdge(graph, "REQ-1", "FEAT-1", "specifies")).toBe(true)
    expect(hasEdge(graph, "EP-1", "FEAT-1", "implements")).toBe(true)
    expect(hasEdge(graph, "EP-2", "ENT-1", "operates_on")).toBe(true)
    expect(hasEdge(graph, "file:okx", "FEAT-2", "implements")).toBe(true)

    const milestone = graph.nodes.find((n) => n.type === "milestone")
    expect(milestone).toBeDefined()
    expect(hasEdge(graph, "TASK-1", milestone!.id, "belongs_to")).toBe(true)
  })

  test("records the migration in history and does not re-run", () => {
    writeLegacyGraph(dir)
    runMigrations(dir)

    const history = JSON.parse(readFileSync(join(dir, ".sdd", "migration-history.json"), "utf-8"))
    expect(history.completed).toContain(BACKFILL_ID)
    expect(hasPendingMigrations(dir)).toBe(false)
    expect(existsSync(join(dir, ".sdd", "graph.yaml"))).toBe(true)
  })
})
