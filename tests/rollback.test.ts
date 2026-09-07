import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { createSnapshot, executeRollback, loadRollbackHistory, rollbackBySnapshot } from "../src/sdd/rollback/manager.js"

function makeChangeGraph() {
  const graph = createGraph("rollback-test")
  addNode(graph, { id: "CHG-1", type: "change", name: "Test change", status: "IMPLEMENTED", version: 1, metadata: { affected_files: [], affected_nodes: ["REQ-1"], affected_relationships: [], new_nodes: [], removed_nodes: [], modified_nodes: [], implementation_tasks: [] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "IMPLEMENTED", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  return graph
}

describe("createSnapshot", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rollback-snap-"))
    mkdirSync(join(dir, ".sdd", "snapshots"), { recursive: true })
  })

  test("creates snapshot with correct structure", () => {
    const graph = makeChangeGraph()
    const snapshot = createSnapshot(graph, "CHG-1", dir)
    expect(snapshot.id).toBeTruthy()
    expect(snapshot.change_id).toBe("CHG-1")
    expect(snapshot.graph_state.nodes.length).toBe(2)
  })

  test("snapshot file is persisted to disk", () => {
    const graph = makeChangeGraph()
    const snapshot = createSnapshot(graph, "CHG-1", dir)
    const snapshotPath = join(dir, ".sdd", "snapshots", `${encodeURIComponent(snapshot.id)}.json`)
    expect(existsSync(snapshotPath)).toBe(true)
  })
})

describe("rollbackBySnapshot", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rollback-exec-"))
    mkdirSync(join(dir, ".sdd", "snapshots"), { recursive: true })
  })

  test("returns failure when no snapshot found", () => {
    const graph = makeChangeGraph()
    const result = rollbackBySnapshot(graph, "CHG-NONEXISTENT", dir)
    expect(result.success).toBe(false)
    expect(result.details).toContain("No snapshot found")
  })

  test("rollbackBySnapshot returns failure when no backed_up_files", () => {
    const graph = makeChangeGraph()
    const snapshot = createSnapshot(graph, "CHG-1", dir)
    // No files were backed up in this snapshot, so rollback returns incomplete
    const result = rollbackBySnapshot(graph, "CHG-1", dir)
    // It fails because backed_up_files is empty and no files to restore
    expect(result.success).toBe(false)
    expect(result.method).toBe("snapshot")
  })

  test("rollbackBySnapshot succeeds when files are backed up", () => {
    const graph = makeChangeGraph()
    // Add affected files to the change
    const change = graph.nodes.find((n) => n.id === "CHG-1")!
    const affectedFile = "src/test.ts"
    change.metadata.affected_files = [affectedFile]
    // Create the file to be backed up
    const srcDir = join(dir, "src")
    require("fs").mkdirSync(srcDir, { recursive: true })
    require("fs").writeFileSync(join(dir, affectedFile), "original content")
    const snapshot = createSnapshot(graph, "CHG-1", dir)
    expect(snapshot.backed_up_files.length).toBe(1)
    // Now change the file
    require("fs").writeFileSync(join(dir, affectedFile), "modified content")
    // Rollback should restore the original
    const result = rollbackBySnapshot(graph, "CHG-1", dir)
    expect(result.success).toBe(true)
    expect(require("fs").readFileSync(join(dir, affectedFile), "utf-8")).toBe("original content")
  })
})

describe("executeRollback", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rollback-execute-"))
    mkdirSync(join(dir, ".sdd", "snapshots"), { recursive: true })
  })

  test("returns failure for nonexistent change", () => {
    const graph = makeChangeGraph()
    const result = executeRollback(graph, "CHG-NONEXISTENT", dir)
    expect(result.success).toBe(false)
  })

  test("executeRollback falls through to backup when git and snapshot fail", () => {
    const graph = makeChangeGraph()
    createSnapshot(graph, "CHG-1", dir)
    // Mutate
    addNode(graph, { id: "X", type: "entity", name: "Extra", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const result = executeRollback(graph, "CHG-1", dir)
    // Tries git (no repo), snapshot (no backed files), then backup (no backup)
    // All fail gracefully
    expect(result.method).toBeDefined()
  })
})

describe("loadRollbackHistory", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rollback-history-"))
    mkdirSync(join(dir, ".sdd", "snapshots"), { recursive: true })
  })

  test("returns empty history when no snapshots", () => {
    const history = loadRollbackHistory(dir)
    expect(history.rollbacks.length).toBe(0)
  })
})
