import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { SqliteGraphRepository } from "../src/sdd/persistence/sqlite.js"
import { YamlGraphRepository } from "../src/sdd/persistence/yaml.js"
import { createRepository } from "../src/sdd/persistence/repository.js"

function makeTestGraph() {
  const graph = createGraph("persistence-test")
  addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: { priority: "critical" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  addNode(graph, { id: "ENT-1", type: "entity", name: "User", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  addRelationship(graph, "REQ-1", "ENT-1", "depends_on")
  return graph
}

describe("SqliteGraphRepository", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sqlite-repo-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("save and load graph round-trip", () => {
    const repo = new SqliteGraphRepository(dir)
    const graph = makeTestGraph()
    repo.saveGraph(graph)
    const loaded = repo.loadGraph()
    expect(loaded.nodes.length).toBe(2)
    expect(loaded.relationships.length).toBe(1)
    expect(loaded.nodes[0].id).toBe("REQ-1")
  })

  test("isInitialized returns true after save", () => {
    const repo = new SqliteGraphRepository(dir)
    expect(repo.isInitialized()).toBe(false)
    repo.saveGraph(makeTestGraph())
    expect(repo.isInitialized()).toBe(true)
  })

  test("invalidateCache resets state", () => {
    const repo = new SqliteGraphRepository(dir)
    repo.saveGraph(makeTestGraph())
    repo.invalidateCache()
    const loaded = repo.loadGraph()
    expect(loaded.nodes.length).toBe(2)
  })

  test("differential save preserves unchanged nodes", () => {
    const repo = new SqliteGraphRepository(dir)
    const graph = makeTestGraph()
    repo.saveGraph(graph)
    // Add a new node and save again
    addNode(graph, { id: "REQ-2", type: "requirement", name: "Logout", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    repo.saveGraph(graph)
    const loaded = repo.loadGraph()
    expect(loaded.nodes.length).toBe(3)
  })

  test("differential save removes deleted nodes", () => {
    const repo = new SqliteGraphRepository(dir)
    const graph = makeTestGraph()
    repo.saveGraph(graph)
    // Remove a node
    graph.nodes = graph.nodes.filter((n) => n.id !== "ENT-1")
    repo.saveGraph(graph)
    const loaded = repo.loadGraph()
    expect(loaded.nodes.length).toBe(1)
    expect(loaded.nodes[0].id).toBe("REQ-1")
  })

  test("getNodesByType returns correct subset", () => {
    const repo = new SqliteGraphRepository(dir)
    repo.saveGraph(makeTestGraph())
    const reqs = repo.getNodesByType("requirement")
    expect(reqs.length).toBe(1)
    expect(reqs[0].id).toBe("REQ-1")
  })

  test("migrateTo creates target backend", () => {
    const sqliteRepo = new SqliteGraphRepository(dir)
    sqliteRepo.saveGraph(makeTestGraph())
    const yamlRepo = sqliteRepo.migrateTo("yaml", dir)
    expect(yamlRepo).toBeInstanceOf(YamlGraphRepository)
    const loaded = yamlRepo.loadGraph()
    expect(loaded.nodes.length).toBe(2)
  })
})

describe("YamlGraphRepository", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "yaml-repo-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("save and load graph round-trip", () => {
    const repo = new YamlGraphRepository(dir)
    const graph = makeTestGraph()
    repo.saveGraph(graph)
    const loaded = repo.loadGraph()
    expect(loaded.nodes.length).toBe(2)
    expect(loaded.relationships.length).toBe(1)
  })

  test("isInitialized returns true after save", () => {
    const repo = new YamlGraphRepository(dir)
    expect(repo.isInitialized()).toBe(false)
    repo.saveGraph(makeTestGraph())
    expect(repo.isInitialized()).toBe(true)
  })

  test("graph.yaml file exists after save", () => {
    const repo = new YamlGraphRepository(dir)
    repo.saveGraph(makeTestGraph())
    expect(existsSync(join(dir, ".sdd", "graph.yaml"))).toBe(true)
  })

  test("migrateTo creates target backend", () => {
    const yamlRepo = new YamlGraphRepository(dir)
    yamlRepo.saveGraph(makeTestGraph())
    const sqliteRepo = yamlRepo.migrateTo("sqlite", dir)
    expect(sqliteRepo).toBeInstanceOf(SqliteGraphRepository)
    const loaded = sqliteRepo.loadGraph()
    expect(loaded.nodes.length).toBe(2)
  })
})

describe("createRepository", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "create-repo-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("creates SQLite repo when .db exists", () => {
    const sqlite = new SqliteGraphRepository(dir)
    sqlite.saveGraph(makeTestGraph())
    const repo = createRepository(dir)
    expect(repo).toBeInstanceOf(SqliteGraphRepository)
    expect(repo.isInitialized()).toBe(true)
  })

  test("creates YAML repo when .yaml exists", () => {
    const yaml = new YamlGraphRepository(dir)
    yaml.saveGraph(makeTestGraph())
    const repo = createRepository(dir)
    expect(repo).toBeInstanceOf(YamlGraphRepository)
    expect(repo.isInitialized()).toBe(true)
  })

  test("creates a repo when neither exists (default)", () => {
    const repo = createRepository(dir)
    expect(repo).toBeDefined()
    expect(repo.isInitialized()).toBe(false)
  })

  test("selects newer backend when both exist", () => {
    // Create YAML first
    const yaml = new YamlGraphRepository(dir)
    yaml.saveGraph(makeTestGraph())
    // Create SQLite later (should be more recent)
    const sqlite = new SqliteGraphRepository(dir)
    sqlite.saveGraph(makeTestGraph())
    const repo = createRepository(dir)
    expect(repo).toBeInstanceOf(SqliteGraphRepository)
  })
})
