import { describe, it, expect, beforeEach } from "bun:test"
import {
  checkToolAccess,
  resetWorkflowState,
  markEnforced,
  markApproved,
  markCompleted,
  getWorkflowState,
  WORKFLOW_REQUIRED_TOOLS,
  WORKFLOW_EXEMPT_TOOLS,
  workflowScope,
} from "../src/sdd/enforcement/workflow-tracker"

describe("Bypass Enforcement", () => {
  beforeEach(() => {
    resetWorkflowState()
  })

  describe("Workflow State Tracker", () => {
    it("isolates concurrent sessions in the same project", () => {
      const first = workflowScope("/project", "session-a")
      const second = workflowScope("/project", "session-b")
      markEnforced("CHG-A", first)
      expect(checkToolAccess("sdd.graph_mutation", second, "add_node").allowed).toBe(false)
      expect(checkToolAccess("sdd.graph_mutation", first, "add_node").allowed).toBe(true)
    })

    it("blocks mutating composite actions while allowing their read actions", () => {
      expect(checkToolAccess("sdd.graph_mutation", "composite-test", "add_node").allowed).toBe(false)
      expect(checkToolAccess("sdd.graph_query", "composite-test", "list_nodes").allowed).toBe(true)
    })

    it("starts in invalid state (no workflow)", () => {
      const state = getWorkflowState()
      expect(state.enforced).toBe(false)
      expect(state.changeId).toBeNull()
    })

    it("markEnforced activates workflow", () => {
      markEnforced("CHG-001")
      const state = getWorkflowState()
      expect(state.enforced).toBe(true)
      expect(state.changeId).toBe("CHG-001")
    })

    it("markCompleted resets workflow", () => {
      markEnforced("CHG-001")
      markCompleted()
      const state = getWorkflowState()
      expect(state.enforced).toBe(false)
      expect(state.changeId).toBeNull()
    })

    it("resetWorkflowState clears everything", () => {
      markEnforced("CHG-001")
      markApproved()
      resetWorkflowState()
      const state = getWorkflowState()
      expect(state.enforced).toBe(false)
      expect(state.approved).toBe(false)
    })
  })

  describe("Graph mutation tools blocked without workflow", () => {
    // As mutações de grafo agora vivem no composite `sdd.graph_mutation` (os
    // nomes antigos foram removidos). A lista cobre os standalones mutantes
    // que exigem workflow ativo.
    const mutationTools = [
      "sdd.generate_code",
      "sdd.fail_change",
      "sdd.bug_fix",
      "sdd.auto_link_tests",
      "sdd.infer_relationships",
      "sdd.migrate_storage",
    ]

    for (const tool of mutationTools) {
      it(`${tool} is blocked without workflow`, () => {
        const result = checkToolAccess(tool)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("SDD workflow")
      })

      it(`${tool} is allowed with active workflow`, () => {
        markEnforced("CHG-001")
        const result = checkToolAccess(tool)
        expect(result.allowed).toBe(true)
      })
    }
  })

  describe("Composite graph mutations are gated per action", () => {
    const mutatingActions = ["add_node", "update_node", "remove_node", "add_relationship", "remove_relationship"]

    for (const action of mutatingActions) {
      it(`sdd.graph_mutation:${action} is blocked without workflow`, () => {
        expect(checkToolAccess("sdd.graph_mutation", undefined, action).allowed).toBe(false)
      })

      it(`sdd.graph_mutation:${action} is allowed with active workflow`, () => {
        markEnforced("CHG-001")
        expect(checkToolAccess("sdd.graph_mutation", undefined, action).allowed).toBe(true)
      })
    }
  })

  describe("Read-only tools always allowed", () => {
    const readOnlyTools = [
      "sdd.inspect",
      "sdd.query_graph",
      "sdd.validate",
      "sdd.detect_drift",
      "sdd.drift_signals",
      "sdd.get_context",
      "sdd.coverage",
      "sdd.analyze_impact",
      "sdd.quality",
      "sdd.pending_changes",
    ]

    for (const tool of readOnlyTools) {
      it(`${tool} is always allowed`, () => {
        const result = checkToolAccess(tool)
        expect(result.allowed).toBe(true)
      })
    }
  })

  describe("Workflow entry points always allowed", () => {
    const entryTools = [
      "sdd.enforce",
      "sdd.discover",
      "sdd.update_from_answers",
      "sdd.create_change",
      "sdd.approve_change",
      "sdd.complete_change",
      "sdd.build_graph",
      "sdd.initialize",
      // Reverse engineering bootstraps the graph from code, so it is an entry
      // point too — it must never be denied by the fail-closed policy.
      "sdd.reverse_engineer",
      "sdd.workflow_reverse_engineer",
    ]

    for (const tool of entryTools) {
      it(`${tool} is always allowed (entry point)`, () => {
        const result = checkToolAccess(tool)
        expect(result.allowed).toBe(true)
      })
    }
  })

  describe("Non-SDD tools not affected", () => {
    it("Write tool not checked by SDD tracker", () => {
      const result = checkToolAccess("Write")
      expect(result.allowed).toBe(true)
    })

    it("Edit tool not checked by SDD tracker", () => {
      const result = checkToolAccess("Edit")
      expect(result.allowed).toBe(true)
    })

    it("run_terminal_command not checked by SDD tracker", () => {
      const result = checkToolAccess("run_terminal_command")
      expect(result.allowed).toBe(true)
    })
  })

  describe("Tool classification completeness", () => {
    it("all mutation tools are in REQUIRED set", () => {
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.generate_code")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.fail_change")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.bug_fix")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.auto_link_tests")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.infer_relationships")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.migrate_storage")).toBe(true)
    })

    it("no mutation tool is in EXEMPT set", () => {
      for (const tool of WORKFLOW_REQUIRED_TOOLS) {
        expect(WORKFLOW_EXEMPT_TOOLS.has(tool)).toBe(false)
      }
    })

    it("read-only tools are in EXEMPT set", () => {
      expect(WORKFLOW_EXEMPT_TOOLS.has("sdd.inspect")).toBe(true)
      expect(WORKFLOW_EXEMPT_TOOLS.has("sdd.query_graph")).toBe(true)
      expect(WORKFLOW_EXEMPT_TOOLS.has("sdd.validate")).toBe(true)
    })

    it("gates milestone mutations while allowing read actions", () => {
      const scope = workflowScope("/project", "milestone-session")

      // Leitura sempre permitida (container isento).
      expect(checkToolAccess("sdd.milestone", scope, "list").allowed).toBe(true)
      expect(checkToolAccess("sdd.milestone", scope, "report").allowed).toBe(true)

      // Mutação exige workflow ativo.
      expect(checkToolAccess("sdd.milestone", scope, "create").allowed).toBe(false)
      markEnforced("CHG-MS", scope)
      expect(checkToolAccess("sdd.milestone", scope, "create").allowed).toBe(true)
    })

    it("classifies relationship inference and Kanban bridge tools", () => {
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.infer_relationships")).toBe(true)
      expect(WORKFLOW_EXEMPT_TOOLS.has("sdd.integrate_tasks")).toBe(true)
      expect(checkToolAccess("sdd.integrate_tasks", "task-test", "list").allowed).toBe(true)
      expect(checkToolAccess("sdd.integrate_tasks", "task-test", "create").allowed).toBe(false)
    })
  })
})
