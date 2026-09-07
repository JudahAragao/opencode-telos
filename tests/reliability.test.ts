import { describe, expect, test } from "bun:test"
import { appendFileSync, mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { calculateCoverage } from "../src/sdd/coverage/tracker.js"
import { validateSmart } from "../src/sdd/validation/smart-validator.js"
import { validateGraph } from "../src/sdd/validation/validator.js"
import { writeGeneratedFiles } from "../src/sdd/codegen/generator.js"
import { validateExecutableProject, validateFunctionalEvidence, saveExecutableValidation, loadExecutableValidation, isExecutableValidationCurrent } from "../src/sdd/validation/executable.js"
import { rankSimilarity } from "../src/opencode/router/embeddings.js"
import { analyzeCodebase } from "../src/code-intelligence/analyzer.js"
import { CacheManager } from "../src/sdd/cache/manager.js"
import { getGraphSnapshotStore } from "../src/sdd/cache/snapshot-store.js"
import { graphFingerprint } from "../src/sdd/cache/fingerprint.js"
import { projectPath } from "../src/sdd/security/paths.js"

describe("Reliability safeguards", () => {
  test("project paths reject traversal and escaping symlinks", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-paths-"))
    try {
      expect(() => projectPath(directory, "../outside.ts")).toThrow()
      expect(projectPath(directory, "src/new.ts", true)).toBe(join(directory, "src/new.ts"))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("empty dirty set performs an authoritative full validation", () => {
    const graph = createGraph("project")
    addNode(graph, {
      id: "REQ-1", type: "requirement", name: "Critical login", status: "DRAFT",
      version: 1, metadata: { priority: "critical" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })

    const result = validateSmart(graph, new Set())
    expect(result.nodes_checked).toBe(graph.nodes.length)
    expect(result.subsystems_skipped).toEqual([])
    expect(result.warnings.some((warning) => warning.code === "REQUIREMENT_NO_TASK")).toBe(true)
  })

  test("validation severity can be configured without weakening the default policy", () => {
    const graph = createGraph("project")
    addNode(graph, {
      id: "REQ-CRITICAL", type: "requirement", name: "Critical payment", status: "DRAFT",
      version: 1, metadata: { priority: "critical" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    const result = validateGraph(graph, {
      critical_requirement_without_test: "warning",
      missing_verification_scenario: "warning",
    })
    expect(result.errors.some((error) => error.code === "CRITICAL_REQUIREMENT_UNTESTED")).toBe(false)
    expect(result.warnings.some((warning) => warning.code === "CRITICAL_REQUIREMENT_UNTESTED")).toBe(true)
  })

  test("coverage requires structured evidence for specialized requirement aspects", () => {
    const graph = createGraph("coverage")
    addNode(graph, {
      id: "REQ-SEC", type: "requirement", name: "Secure login", status: "DRAFT", version: 1,
      description: "The login must satisfy security controls", metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    addNode(graph, {
      id: "TEST-SEC", type: "test", name: "login test", status: "IMPLEMENTED", version: 1,
      metadata: { test_type: "unit", target: "login.test.ts" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    addRelationship(graph, "REQ-SEC", "TEST-SEC", "tested_by")
    expect(calculateCoverage(graph).items[0].coverage_type).toBe("none")
    const test = graph.nodes.find((node) => node.id === "TEST-SEC")!
    test.metadata.covered_aspects = ["security"]
    expect(calculateCoverage(graph).items[0].coverage_type).toBe("full")
  })

  test("functional verification requires explicit evidence for acceptance criteria", () => {
    const graph = createGraph("functional-evidence")
    addNode(graph, {
      id: "REQ-F", type: "requirement", name: "Payment requirement", status: "DRAFT", version: 1,
      metadata: { acceptance_criteria: ["payment is rejected when expired"] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    addNode(graph, {
      id: "TEST-F", type: "test", name: "payment test", status: "IMPLEMENTED", version: 1,
      metadata: { test_type: "unit", verifies: [] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    addNode(graph, {
      id: "CHG-F", type: "change", name: "Payment change", status: "DRAFT", version: 1,
      metadata: {
        title: "Payment change", reason: "Requirement implementation", approval_level: "AUTO",
        affected_nodes: ["REQ-F"], affected_relationships: [], new_nodes: [], removed_nodes: [], modified_nodes: [],
        affected_files: [], affected_tests: ["TEST-F"], implementation_tasks: [],
      }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    addRelationship(graph, "REQ-F", "TEST-F", "tested_by")
    expect(validateFunctionalEvidence(graph, "CHG-F").verified).toBe(false)
    const test = graph.nodes.find((node) => node.id === "TEST-F")!
    ;(test.metadata as { verifies: string[] }).verifies = ["payment is rejected when expired"]
    expect(validateFunctionalEvidence(graph, "CHG-F").verified).toBe(true)
  })

  test("generation reports a conflict instead of replacing brownfield code", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-generation-"))
    const path = join(directory, "src/example.ts")
    try {
      const initial = writeGeneratedFiles(directory, {
        directories: ["src"], summary: "", files: [{ path: "src/example.ts", content: "export const value = 1\n", description: "example" }],
      })
      expect(initial.written).toBe(1)

      const conflict = writeGeneratedFiles(directory, {
        directories: ["src"], summary: "", files: [{ path: "src/example.ts", content: "export const value = 2\n", description: "example" }],
      })
      expect(conflict.written).toBe(0)
      expect(conflict.conflicts).toEqual(["src/example.ts"])
      expect(readFileSync(path, "utf-8")).toBe("export const value = 1\n")

      const replacement = writeGeneratedFiles(directory, {
        directories: ["src"], summary: "", files: [{ path: "src/example.ts", content: "export const value = 2\n", description: "example" }],
      }, { overwrite: true })
      expect(replacement.written).toBe(1)
      expect(replacement.backups).toHaveLength(1)
      expect(existsSync(replacement.backups[0])).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("executable validation uses only project-declared scripts and persists its report", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-verification-"))
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts: { typecheck: "bun --version" } }))
      const result = validateExecutableProject(directory)
      expect(result.passed).toBe(true)
      expect(result.verified).toBe(true)
      expect(result.checks.find((check) => check.name === "typecheck")?.status).toBe("passed")
      saveExecutableValidation(directory, "CHG-1", result)
      expect(loadExecutableValidation(directory, "CHG-1")?.passed).toBe(true)
      expect(isExecutableValidationCurrent(directory, result)).toBe(true)
      writeFileSync(join(directory, "src.ts"), "export const changed = true\n")
      expect(isExecutableValidationCurrent(directory, result)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("routing relevance favors exact technical terms without pseudo-semantic hashes", () => {
    const ranked = rankSimilarity("validate graph", [
      { label: "validate", text: "Validate the SDD Knowledge Graph for structural integrity" },
      { label: "generate", text: "Generate project files from an approved specification" },
    ])
    expect(ranked[0]?.label).toBe("validate")
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score || 0)
  })

  test("code intelligence recognizes declarations in supported non-JS languages", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-code-intel-"))
    try {
      const source = join(directory, "src")
      mkdirSync(source, { recursive: true })
      writeFileSync(join(source, "app.py"), "class Account:\n    def process(self):\n        return True\n")
      writeFileSync(join(source, "app.go"), "package app\n\nimport \"fmt\"\n\ntype Account struct{}\nfunc Process() {}\n")
      writeFileSync(join(source, "app.rs"), "use std::io;\npub struct Account;\npub fn process() {}\n")
      writeFileSync(join(source, "App.java"), "import java.util.List;\npublic class Account {\n  public void process() {}\n}\n")
      writeFileSync(join(source, "app.rb"), "require 'json'\nclass Account\n  def process; end\nend\n")
      const graph = createGraph("polyglot")
      const result = analyzeCodebase(graph, directory)
      expect(result.files_analyzed).toBe(5)
      expect(result.symbols_found).toBeGreaterThanOrEqual(10)
      expect(graph.nodes.some((node) => node.name === "Account")).toBe(true)
      expect(graph.nodes.some((node) => node.name === "process")).toBe(true)
      const firstIds = graph.nodes.filter((node) => node.type === "file" || node.type === "symbol").map((node) => node.id).sort()
      expect(existsSync(join(directory, ".sdd", "ast-cache.json"))).toBe(true)
      const secondGraph = createGraph("polyglot")
      analyzeCodebase(secondGraph, directory)
      const secondIds = secondGraph.nodes.filter((node) => node.type === "file" || node.type === "symbol").map((node) => node.id).sort()
      expect(secondIds).toEqual(firstIds)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("code intelligence resolves imported aliases without linking homonyms", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-import-resolution-"))
    try {
      const source = join(directory, "src")
      mkdirSync(source, { recursive: true })
      writeFileSync(join(source, "account.ts"), "export class Account { static load() { return true } }\n")
      writeFileSync(join(source, "other.ts"), "export class Account { static load() { return false } }\n")
      writeFileSync(join(source, "index.ts"), "export { Account as PublicAccount } from './account'\n")
      writeFileSync(join(source, "consumer.ts"), "import { PublicAccount } from './index'\nexport function run() { return PublicAccount.load() }\n")

      const graph = createGraph("imports")
      analyzeCodebase(graph, directory)
      const account = graph.nodes.find((node) => node.type === "symbol" && node.name === "Account.load" && (node.metadata as Record<string, unknown>).file_path === "src/account.ts")!
      const other = graph.nodes.find((node) => node.type === "symbol" && node.name === "Account.load" && (node.metadata as Record<string, unknown>).file_path === "src/other.ts")!
      const run = graph.nodes.find((node) => node.type === "symbol" && node.name === "run")!
      expect(graph.relationships.some((rel) => rel.type === "calls" && rel.from === run.id && rel.to === account.id)).toBe(true)
      expect(graph.relationships.some((rel) => rel.type === "calls" && rel.from === run.id && rel.to === other.id)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("graph fingerprints detect content changes with identical counts", () => {
    const first = createGraph("fingerprint")
    addNode(first, {
      id: "REQ-1", type: "requirement", name: "Same count", description: "before", status: "DRAFT",
      version: 1, metadata: {}, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    })
    const second = structuredClone(first)
        second.nodes[0].description = "after"
    expect(graphFingerprint(first)).not.toBe(graphFingerprint(second))
  })

  test("cache entries revalidate after config and source changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-cache-"))
    try {
      mkdirSync(join(directory, ".sdd"), { recursive: true })
      mkdirSync(join(directory, "src"), { recursive: true })
      writeFileSync(join(directory, ".sdd", "config.json"), "{}")
      writeFileSync(join(directory, "src", "app.ts"), "export const value = 1\n")
      const manager = new CacheManager(directory)
      const graph = createGraph("cache")
      const fingerprint = graphFingerprint(graph)

      manager.setToolResponse("sdd.query_graph", {}, "graph-result", fingerprint)
      expect(manager.getToolResponse("sdd.query_graph", {}, fingerprint)).toBe("graph-result")
      writeFileSync(join(directory, ".sdd", "config.json"), JSON.stringify({ validation: { strict: true } }))
      expect(manager.getToolResponse("sdd.query_graph", {}, fingerprint)).toBeNull()

      manager.setToolResponse("sdd.detect_drift", {}, "drift-result", fingerprint)
      expect(manager.getToolResponse("sdd.detect_drift", {}, fingerprint)).toBe("drift-result")
      writeFileSync(join(directory, "src", "app.ts"), "export const value = 2\n")
      expect(manager.getToolResponse("sdd.detect_drift", {}, fingerprint)).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("persistent cache survives a new manager and rejects corrupted data", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-cache-restart-"))
    try {
      mkdirSync(join(directory, ".sdd"), { recursive: true })
      writeFileSync(join(directory, ".sdd", "config.json"), "{}")
      const graph = createGraph("restart")
      const fingerprint = graphFingerprint(graph)
      const first = new CacheManager(directory)
      first.setToolResponse("sdd.query_graph", { page: 1 }, "persisted", fingerprint)
      first.persistToDisk()

      const second = new CacheManager(directory)
      expect(second.restoreFromPersistentCache()).toBe(1)
      expect(second.getToolResponse("sdd.query_graph", { page: 1 }, fingerprint)).toBe("persisted")

      writeFileSync(join(directory, ".sdd", "cache.json"), "{broken")
      const third = new CacheManager(directory)
      expect(third.restoreFromPersistentCache()).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("snapshot validates source identity and graph integrity", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-snapshot-"))
    try {
      mkdirSync(join(directory, ".sdd"), { recursive: true })
      const graph = createGraph("snapshot")
      const store = getGraphSnapshotStore(directory)
      store.save(graph, graphFingerprint(graph), "source-v1")
      expect(store.load()?.graph.project_id).toBe("snapshot")

      writeFileSync(join(directory, ".sdd", "graph-cache.json"), "{broken")
      expect(store.load()).toBeNull()

      store.save(graph, "wrong-fingerprint", "source-v2")
      expect(store.load()).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("persistent invalidation journal clears a cache changed by another process", () => {
    const directory = mkdtempSync(join(tmpdir(), "opencode-telos-cache-process-"))
    try {
      mkdirSync(join(directory, ".sdd"), { recursive: true })
      const graph = createGraph("process")
      const fingerprint = graphFingerprint(graph)
      const manager = new CacheManager(directory)
      manager.setToolResponse("sdd.query_graph", {}, "stale", fingerprint)
      manager.persistToDisk()

      const restarted = new CacheManager(directory)
      restarted.restoreFromPersistentCache()
      appendFileSync(join(directory, ".sdd", "cache-events.jsonl"), `${JSON.stringify({
        id: "external-event", timestamp: Date.now(), pid: process.pid + 1, nodeTypes: ["requirement"], relTypes: [], full: true,
      })}\n`)
      expect(restarted.getToolResponse("sdd.query_graph", {}, fingerprint)).toBeNull()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
