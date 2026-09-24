import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createGraph, addNode, addRelationship } from "../src/sdd/graph/engine.js"
import { executeChain } from "../src/opencode/workflows/executor.js"
import { readExecutionRecords } from "../src/sdd/execution/ledger.js"
import { extractPromises, stablePromiseId, verifyPromise } from "../src/sdd/promises/tracker.js"
import { updateGraphFromAnswers } from "../src/sdd/discovery/briefing.js"
import type { WorkflowChain } from "../src/opencode/workflows/chains.js"

function node(id: string, type: "project" | "requirement" | "test" | "file" | "feature"): any {
  return {
    id,
    type,
    name: id,
    description: id,
    status: type === "project" ? "APPROVED" : "DRAFT",
    version: 1,
    metadata: type === "requirement"
      ? { acceptance_criteria: ["A user can create an account", "A user can sign in"] }
      : type === "test"
        ? { test_type: "integration", verifies: [] }
        : type === "file" ? { path: "src/accounts.ts" } : {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

describe("execution identity and traceability", () => {
  test("records run and step identities and propagates cancellation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "telos-execution-"))
    try {
      const chain: WorkflowChain = {
        name: "trace-chain",
        description: "trace",
        params: [],
        steps: [{ tool: "slow", args: {}, required: true, description: "cancellable" }],
      }
      const result = await executeChain(chain, {}, async (_tool, _args, context) => new Promise<string>((resolve, reject) => {
        context?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
        setTimeout(() => resolve("late"), 1000)
      }), { stepTimeoutMs: 20, chainTimeoutMs: 200 })
      expect(result.success).toBe(false)
      const records = readExecutionRecords(dir)
      expect(records.length).toBe(0)

      const persisted = await executeChain(chain, {}, async (_tool, _args, context) => {
        if (context?.signal?.aborted) throw new Error("aborted")
        return "done"
      }, { stepTimeoutMs: 100, chainTimeoutMs: 200 }, undefined, { projectDir: dir, sessionId: "s", messageId: "m", runId: "stable-run" })
      expect(persisted.success).toBe(true)
      let retriedCalls = 0
      const retried = await executeChain(chain, {}, async () => {
        retriedCalls++
        return "should not execute"
      }, { stepTimeoutMs: 100, chainTimeoutMs: 200 }, undefined, { projectDir: dir, sessionId: "s", messageId: "m", runId: "stable-run" })
      expect(retried.success).toBe(true)
      expect(retriedCalls).toBe(0)
      const runRecords = readExecutionRecords(dir).filter((record) => record.runId === "stable-run")
      expect(runRecords.some((record) => record.stepId?.includes("STEP-001"))).toBe(true)
      expect(runRecords.some((record) => record.status === "completed" && !record.stepId)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("keeps promise identity after acceptance criteria reorder and requires linked evidence", () => {
    const graph = createGraph("project", "Project")
    addNode(graph, node("project", "project"))
    const requirement = node("REQ-001", "requirement")
    addNode(graph, requirement)
    addNode(graph, node("TEST-001", "test"))
    addRelationship(graph, "REQ-001", "TEST-001", "tested_by")
    const promises = extractPromises(graph, { autoClassify: false })
    const firstId = stablePromiseId("REQ-001", "A user can create an account")
    expect(promises.map((promise) => promise.id)).toContain(firstId)
    expect(verifyPromise(graph, firstId, {
      evidence: "Integration test passed",
      evidence_refs: [{ type: "test", id: "TEST-001", summary: "account flow" }],
      execution_id: "EXE-1",
    })).not.toBeNull()

    requirement.metadata.acceptance_criteria = ["A user can sign in", "A user can create an account"]
    const reordered = extractPromises(graph, { autoClassify: false })
    expect(reordered.find((promise) => promise.id === firstId)?.status).toBe("fulfilled")
  })

  test("persists discovery answers as decisions with provenance", () => {
    const graph = createGraph("project", "Project")
    addNode(graph, node("project", "project"))
    updateGraphFromAnswers(graph, { "Qual banco usar?": "SQLite" }, { executionId: "EXE-DISC", sessionId: "SESSION-1" })
    expect(graph.nodes.some((candidate) => candidate.type === "decision" && (candidate.metadata as any).decision === "SQLite")).toBe(true)
    expect((graph.metadata as any).discovery_answers[0].decision_id).toContain("DEC-project-DISCOVERY")
    expect((graph.metadata as any).discovery_last_execution_id).toBe("EXE-DISC")
  })
})
