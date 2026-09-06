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
} from "../src/sdd/enforcement/workflow-tracker"

describe("Bypass Enforcement", () => {
  beforeEach(() => {
    resetWorkflowState()
  })

  describe("Workflow State Tracker", () => {
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
    const mutationTools = [
      "sdd.add_node",
      "sdd.update_node",
      "sdd.remove_node",
      "sdd.add_relationship",
      "sdd.remove_relationship",
      "sdd.generate_code",
      "sdd.remove_dead_code",
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

  describe("Read-only tools always allowed", () => {
    const readOnlyTools = [
      "sdd.inspect",
      "sdd.query_graph",
      "sdd.validate",
      "sdd.detect_drift",
      "sdd.list_nodes",
      "sdd.get_context",
      "sdd.find_path",
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
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.add_node")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.update_node")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.remove_node")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.add_relationship")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.remove_relationship")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.generate_code")).toBe(true)
      expect(WORKFLOW_REQUIRED_TOOLS.has("sdd.remove_dead_code")).toBe(true)
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
  })
})
