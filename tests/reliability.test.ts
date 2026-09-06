import { describe, expect, test } from "bun:test"
import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode } from "../src/sdd/graph/engine.js"
import { validateSmart } from "../src/sdd/validation/smart-validator.js"
import { validateGraph } from "../src/sdd/validation/validator.js"
import { writeGeneratedFiles } from "../src/sdd/codegen/generator.js"
import { validateExecutableProject, saveExecutableValidation, loadExecutableValidation, isExecutableValidationCurrent } from "../src/sdd/validation/executable.js"
import { rankSimilarity } from "../src/opencode/router/embeddings.js"
import { analyzeCodebase } from "../src/code-intelligence/analyzer.js"

describe("Reliability safeguards", () => {
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
})
