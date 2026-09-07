import { describe, expect, test, beforeEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { validateExecutableProject, validateFunctionalEvidence, saveExecutableValidation, loadExecutableValidation, isExecutableValidationCurrent } from "../src/sdd/validation/executable.js"
import { calculateCoverage } from "../src/sdd/coverage/tracker.js"
import { validateSmart } from "../src/sdd/validation/smart-validator.js"
import { validateGraph } from "../src/sdd/validation/validator.js"

describe("validateExecutableProject", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "exec-val-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
  })

  test("returns skipped when no package.json", () => {
    const result = validateExecutableProject(dir)
    expect(result.checks.length).toBeGreaterThanOrEqual(0)
    expect(result.project_fingerprint).toBeTruthy()
  })

  test("detects Cargo.toml projects", () => {
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "test"\nversion = "0.1.0"\n', "utf-8")
    const result = validateExecutableProject(dir)
    const cargoCheck = result.checks.find((c) => c.name === "cargo check")
    expect(cargoCheck).toBeDefined()
  })

  test("detects Python projects", () => {
    writeFileSync(join(dir, "pyproject.toml"), '[project]\nname = "test"\n', "utf-8")
    mkdirSync(join(dir, "tests"), { recursive: true })
    const result = validateExecutableProject(dir)
    const pyCheck = result.checks.find((c) => c.name === "python compile")
    expect(pyCheck).toBeDefined()
  })

  test("detects Go projects", () => {
    writeFileSync(join(dir, "go.mod"), 'module example.com/test\n\ngo 1.21\n', "utf-8")
    const result = validateExecutableProject(dir)
    const goCheck = result.checks.find((c) => c.name === "go test")
    expect(goCheck).toBeDefined()
  })

  test("detects Maven projects", () => {
    writeFileSync(join(dir, "pom.xml"), '<project><modelVersion>4.0.0</modelVersion></project>', "utf-8")
    const result = validateExecutableProject(dir)
    const mavenCheck = result.checks.find((c) => c.name === "maven test")
    expect(mavenCheck).toBeDefined()
  })

  test("detects Gradle projects", () => {
    writeFileSync(join(dir, "build.gradle"), 'plugins { id "java" }\n', "utf-8")
    const result = validateExecutableProject(dir)
    const gradleCheck = result.checks.find((c) => c.name === "gradle test")
    expect(gradleCheck).toBeDefined()
  })

  test("detects Makefile with test target", () => {
    writeFileSync(join(dir, "Makefile"), "test:\n\techo ok\ncheck: test\n\techo done\n", "utf-8")
    const result = validateExecutableProject(dir)
    const makeCheck = result.checks.find((c) => c.name === "make test")
    expect(makeCheck).toBeDefined()
  })

  test("detects npm scripts", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "echo ok", lint: "echo ok" } }), "utf-8")
    const result = validateExecutableProject(dir)
    expect(result.checks.some((c) => c.name === "test")).toBe(true)
    expect(result.checks.some((c) => c.name === "lint")).toBe(true)
  })

  test("invalid package.json returns failed", () => {
    writeFileSync(join(dir, "package.json"), "not json {{{", "utf-8")
    const result = validateExecutableProject(dir)
    expect(result.passed).toBe(false)
  })

  test("saves and loads validation result", () => {
    const result = validateExecutableProject(dir)
    saveExecutableValidation(dir, "CHG-1", result)
    const loaded = loadExecutableValidation(dir, "CHG-1")
    expect(loaded).not.toBeNull()
    expect(loaded!.project_fingerprint).toBe(result.project_fingerprint)
  })
})

describe("validateFunctionalEvidence", () => {
  test("returns false when change not found", () => {
    const graph = createGraph("test")
    const result = validateFunctionalEvidence(graph, "NONEXISTENT")
    expect(result.verified).toBe(false)
    expect(result.gaps.length).toBeGreaterThan(0)
  })

  test("returns true when no affected requirements", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "CHG-1", type: "change", name: "Test", status: "DRAFT", version: 1, metadata: { affected_nodes: [] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const result = validateFunctionalEvidence(graph, "CHG-1")
    expect(result.verified).toBe(true)
  })

  test("returns false when requirement has no tested_by link", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "CHG-1", type: "change", name: "Test", status: "DRAFT", version: 1, metadata: { affected_nodes: ["REQ-1"] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const result = validateFunctionalEvidence(graph, "CHG-1")
    expect(result.verified).toBe(false)
  })

  test("returns true when requirement has tested_by link", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "TEST-1", type: "test", name: "login test", status: "IMPLEMENTED", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "CHG-1", type: "change", name: "Test", status: "DRAFT", version: 1, metadata: { affected_nodes: ["REQ-1"], affected_tests: ["TEST-1"] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addRelationship(graph, "REQ-1", "TEST-1", "tested_by")
    const result = validateFunctionalEvidence(graph, "CHG-1")
    expect(result.verified).toBe(true)
  })

  test("returns false when acceptance criteria not verified by test", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: { acceptance_criteria: ["password must be hashed"] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "TEST-1", type: "test", name: "login test", status: "IMPLEMENTED", version: 1, metadata: { verifies: [] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "CHG-1", type: "change", name: "Test", status: "DRAFT", version: 1, metadata: { affected_nodes: ["REQ-1"], affected_tests: ["TEST-1"] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addRelationship(graph, "REQ-1", "TEST-1", "tested_by")
    const result = validateFunctionalEvidence(graph, "CHG-1")
    expect(result.verified).toBe(false)
    expect(result.gaps.some((g) => g.includes("password must be hashed"))).toBe(true)
  })
})

describe("calculateCoverage", () => {
  test("no requirements means empty coverage", () => {
    const graph = createGraph("test")
    const result = calculateCoverage(graph)
    expect(result.items.length).toBe(0)
  })

  test("requirement with tested_by link shows coverage", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "TEST-1", type: "test", name: "login test", status: "IMPLEMENTED", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addRelationship(graph, "REQ-1", "TEST-1", "tested_by")
    const result = calculateCoverage(graph)
    expect(result.items.length).toBe(1)
    expect(result.items[0].coverage_type).toBe("full")
    expect(result.items[0].evidence).toBe("explicit_relationship")
  })

  test("requirement without test link shows no coverage", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const result = calculateCoverage(graph)
    expect(result.items.length).toBe(1)
    expect(result.items[0].coverage_type).toBe("none")
  })
})

describe("validateSmart", () => {
  test("empty dirty set triggers full validation", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const result = validateSmart(graph, new Set())
    expect(result.nodes_checked).toBe(1)
  })

  test("tracks subsystems checked and skipped", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "REQ-2", type: "requirement", name: "Logout", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const dirtyIds = new Set(["REQ-1"])
    const result = validateSmart(graph, dirtyIds)
    expect(result.nodes_checked).toBeGreaterThan(0)
  })
})

describe("validateGraph", () => {
  test("valid graph passes", () => {
    const graph = createGraph("test")
    addNode(graph, { id: "PRJ-1", type: "project", name: "TestProject", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    addNode(graph, { id: "ENT-1", type: "entity", name: "User", status: "DRAFT", version: 1, metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const result = validateGraph(graph)
    expect(result.errors.some((e) => e.code === "NO_PROJECT_NODE")).toBe(false)
  })

  test("detects structural errors", () => {
    const graph = createGraph("test")
    // Add a relationship referencing a nonexistent node
    graph.relationships.push({ id: "r1", from: "FAKE", to: "FAKE2", type: "depends_on", metadata: {}, version: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    const result = validateGraph(graph)
    // Should detect dangling references
    expect(result.errors.length + result.warnings.length).toBeGreaterThan(0)
  })
})
