import { describe, test, expect, beforeEach } from "bun:test"
import { analyzeBriefing, generateDiscoveryQuestions, isBriefingSufficient } from "../src/sdd/discovery/briefing.js"
import { createChange, classifyApprovalLevel } from "../src/sdd/changes/manager.js"
import { validateGraph } from "../src/sdd/validation/validator.js"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { getToggleState, setToggleState, isSddEnabled } from "../src/sdd/toggle/state.js"
import type { KnowledgeGraph, AnyNode } from "../src/sdd/domain/types.js"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

function makeNode(id: string, type: string = "feature"): AnyNode {
  return {
    id,
    type: type as AnyNode["type"],
    name: `Node ${id}`,
    status: "DRAFT",
    version: 1,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as AnyNode
}

describe("Briefing Analyzer", () => {
  test("detects React in briefing", () => {
    const analysis = analyzeBriefing("Quero um sistema com React e Express")
    expect(analysis.tech_stack.frontend).toBe("React")
    expect(analysis.tech_stack.backend).toBe("Express")
  })

  test("detects database technology", () => {
    const analysis = analyzeBriefing("Sistema com PostgreSQL e Redis")
    expect(analysis.tech_stack.database).toBe("PostgreSQL")
    expect(analysis.tech_stack.other).toContain("Redis")
  })

  test("detects auth patterns", () => {
    const analysis = analyzeBriefing("Precisa de autenticação com JWT")
    expect(analysis.tech_stack.auth).toBe("JWT")
  })

  test("detects OAuth", () => {
    const analysis = analyzeBriefing("Login com Google OAuth")
    expect(analysis.tech_stack.auth).toBe("Google OAuth")
  })

  test("detects entities from nouns", () => {
    const analysis = analyzeBriefing("Sistema de gerenciamento de tarefas com usuários e projetos")
    expect(analysis.inferred_entities.length).toBeGreaterThan(0)
  })

  test("detects multi-tenancy", () => {
    const analysis = analyzeBriefing("Sistema multi-tenant com organizações")
    expect(analysis.known_facts["multi_tenant"]).toBe("true")
  })

  test("detects domain", () => {
    const analysis = analyzeBriefing("Quero um CMS para blog com posts e páginas")
    expect(analysis.domain_detected).toBe("cms")
  })

  test("detects ambiguities", () => {
    const analysis = analyzeBriefing("Sistema simples com compartilhamento")
    expect(analysis.ambiguities.length).toBeGreaterThan(0)
  })

  test("detects @ file references", () => {
    const analysis = analyzeBriefing("Use @tech.md for stack info")
    expect(analysis.file_references.length).toBe(1)
    expect(analysis.file_references[0].path).toBe("tech.md")
  })

  test("detects Python backend", () => {
    const analysis = analyzeBriefing("Backend com FastAPI e PostgreSQL")
    expect(analysis.tech_stack.backend).toBe("FastAPI")
    expect(analysis.tech_stack.database).toBe("PostgreSQL")
  })
})

describe("Discovery Questions", () => {
  test("generates auth question when missing", () => {
    const analysis = analyzeBriefing("Quero um CRUD de tarefas")
    const questions = generateDiscoveryQuestions(analysis)
    expect(questions.some((q) => q.question.includes("login"))).toBe(true)
  })

  test("skips auth question when specified", () => {
    const analysis = analyzeBriefing("Sistema com autenticação JWT")
    const questions = generateDiscoveryQuestions(analysis)
    expect(questions.some((q) => q.question.includes("login"))).toBe(false)
  })

  test("generates tech question when missing", () => {
    const analysis = analyzeBriefing("Quero um sistema de tarefas")
    const questions = generateDiscoveryQuestions(analysis)
    expect(questions.some((q) => q.question.includes("tecnologia") || q.question.includes("frontend"))).toBe(true)
  })

  test("skips tech question when specified", () => {
    const analysis = analyzeBriefing("React + Express + SQLite")
    const questions = generateDiscoveryQuestions(analysis)
    expect(questions.some((q) => q.question.includes("tecnologia"))).toBe(false)
  })

  test("returns QuestionForUser objects with options", () => {
    const analysis = analyzeBriefing("Quero um sistema de tarefas")
    const questions = generateDiscoveryQuestions(analysis)
    for (const q of questions) {
      expect(q).toHaveProperty("question")
      expect(q).toHaveProperty("header")
      expect(q).toHaveProperty("options")
      expect(Array.isArray(q.options)).toBe(true)
      expect(q.options.length).toBeGreaterThan(0)
    }
  })

  test("skips all questions when briefing is complete", () => {
    const analysis = analyzeBriefing("React + Express + SQLite com JWT login e soft delete, multi-tenant")
    const questions = generateDiscoveryQuestions(analysis)
    const criticalMissing = analysis.missing_information.filter(
      (m) => m.classification === "CRITICAL" && !m.already_answered,
    )
    expect(criticalMissing.length).toBe(0)
  })
})

describe("Change Manager", () => {
  let graph: KnowledgeGraph

  beforeEach(() => {
    graph = createGraph("test")
    graph.project_id = "test"
    addNode(graph, makeNode("test-FEAT-001", "feature"))
    addNode(graph, makeNode("test-REQ-001", "requirement"))
    addRelationship(graph, "test-FEAT-001", "test-REQ-001", "satisfies")
  })

  test("creates a change node", () => {
    const change = createChange(graph, {
      title: "Add priority to todos",
      reason: "Users need to prioritize tasks",
      affected_node_ids: ["test-FEAT-001"],
      new_nodes: [],
      modified_nodes: [],
      removed_node_ids: [],
      affected_files: [],
      affected_tests: [],
      implementation_tasks: [],
    })

    expect(change.id).toMatch(/^CHG-\d+$/)
    expect(change.type).toBe("change")
    expect(change.status).toBe("DRAFT")
  })

  test("classifies approval level", () => {
    const level = classifyApprovalLevel(
      {
        title: "Small change",
        reason: "Minor",
        affected_node_ids: ["test-FEAT-001"],
        new_nodes: [],
        modified_nodes: [],
        removed_node_ids: [],
        affected_files: [],
        affected_tests: [],
        implementation_tasks: [],
      },
      graph,
    )
    expect(["AUTO", "REVIEW"]).toContain(level)
  })

  test("classifies architecture change as APPROVAL", () => {
    addNode(graph, makeNode("test-ARCH-001", "architecture_component"))
    const level = classifyApprovalLevel(
      {
        title: "Change database",
        reason: "Switch from SQLite to PostgreSQL",
        affected_node_ids: ["test-ARCH-001"],
        new_nodes: [],
        modified_nodes: [],
        removed_node_ids: [],
        affected_files: [],
        affected_tests: [],
        implementation_tasks: [],
      },
      graph,
    )
    expect(level).toBe("APPROVAL")
  })

  test("classifies destructive change as BLOCKED", () => {
    const level = classifyApprovalLevel(
      {
        title: "Delete entity",
        reason: "Remove old entity",
        affected_node_ids: [],
        new_nodes: [],
        modified_nodes: [],
        removed_node_ids: ["test-REQ-001"],
        affected_files: [],
        affected_tests: [],
        implementation_tasks: [],
      },
      graph,
    )
    expect(level).toBe("BLOCKED")
  })
})

describe("Validator", () => {
  test("validates clean graph", () => {
    const g = createGraph("test")
    g.project_id = "test"
    addNode(g, {
      id: "test-PROJ",
      type: "project",
      name: "Test Project",
      status: "DRAFT",
      version: 1,
      metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const result = validateGraph(g)
    expect(result.errors).toHaveLength(0)
  })

  test("detects duplicate IDs", () => {
    const g = createGraph("test")
    g.project_id = "test"
    g.nodes.push(
      { id: "DUP", type: "feature", name: "A", status: "DRAFT", version: 1, metadata: {}, created_at: "", updated_at: "" } as AnyNode,
      { id: "DUP", type: "feature", name: "B", status: "DRAFT", version: 1, metadata: {}, created_at: "", updated_at: "" } as AnyNode,
    )
    const result = validateGraph(g)
    expect(result.errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true)
  })

  test("detects dangling references", () => {
    const g = createGraph("test")
    g.project_id = "test"
    g.relationships.push({
      id: "REL-1",
      from: "MISSING",
      to: "ALSO_MISSING",
      type: "depends_on",
      metadata: {},
    })
    const result = validateGraph(g)
    expect(result.errors.some((e) => e.code === "DANGLING_REFERENCE")).toBe(true)
  })

  test("warns about requirements without tasks", () => {
    const g = createGraph("test")
    g.project_id = "test"
    addNode(g, makeNode("REQ-001", "requirement"))
    const result = validateGraph(g)
    expect(result.warnings.some((w) => w.code === "REQUIREMENT_NO_TASK")).toBe(true)
  })
})

describe("Toggle State", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sdd-toggle-"))
  })

  test("defaults to enabled", () => {
    const state = getToggleState(tmpDir)
    expect(state.enabled).toBe(true)
  })

  test("toggles to disabled", () => {
    const state = setToggleState(tmpDir, false)
    expect(state.enabled).toBe(false)
    expect(isSddEnabled(tmpDir)).toBe(false)
  })

  test("toggles back to enabled", () => {
    setToggleState(tmpDir, false)
    const state = setToggleState(tmpDir, true)
    expect(state.enabled).toBe(true)
    expect(isSddEnabled(tmpDir)).toBe(true)
  })

  test("persists state across reads", () => {
    setToggleState(tmpDir, false)
    const state1 = getToggleState(tmpDir)
    const state2 = getToggleState(tmpDir)
    expect(state1.enabled).toBe(false)
    expect(state2.enabled).toBe(false)
  })
})
