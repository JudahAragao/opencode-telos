import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode } from "../src/sdd/graph/engine.js"
import { checkSpecEvidence, createChange, preflightChangeScope } from "../src/sdd/changes/manager.js"
import {
  computeProjectFingerprint,
  computeScopedFileHashes,
  validateExecutableProject,
  verifyScopedFiles,
  type ExecutableValidationResult,
} from "../src/sdd/validation/executable.js"
import {
  getWorkflowState,
  isWorkflowValid,
  markApproved,
  markEnforced,
  renewWorkflow,
  resetWorkflowState,
  workflowScope,
} from "../src/sdd/enforcement/workflow-tracker.js"
import { createSddTools } from "../src/opencode/tools.js"

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `opencode-telos-${prefix}-`))
}

function makeChangeGraph(changeMetadata: Record<string, unknown>): ReturnType<typeof createGraph> {
  const graph = createGraph("test")
  addNode(graph, {
    id: "CHG-001",
    type: "change",
    name: "Change",
    status: "DRAFT",
    version: 1,
    metadata: changeMetadata,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as never)
  return graph
}

describe("Change scope preflight (G3)", () => {
  test("a Change with no affected_files is a blocker", () => {
    const graph = makeChangeGraph({ affected_files: [], affected_nodes: [] })
    const preflight = preflightChangeScope(graph, "CHG-001")
    expect(preflight.blockers.length).toBe(1)
    expect(preflight.blockers[0]).toContain("affected_files")
  })

  test("declared files clear the blocker and requirements raise the warning", () => {
    const graph = makeChangeGraph({ affected_files: ["src/a.ts"], affected_nodes: [] })
    const preflight = preflightChangeScope(graph, "CHG-001")
    expect(preflight.blockers).toEqual([])
    expect(preflight.warnings.length).toBe(1)
  })

  test("no_requirement_impact silences the requirement warning", () => {
    const graph = makeChangeGraph({ affected_files: ["src/a.ts"], affected_nodes: [], no_requirement_impact: true })
    expect(preflightChangeScope(graph, "CHG-001").warnings).toEqual([])
  })

  test("unknown change is reported instead of silently passing", () => {
    const graph = makeChangeGraph({ affected_files: [], affected_nodes: [] })
    expect(preflightChangeScope(graph, "CHG-404").blockers.length).toBe(1)
  })
})

describe("Spec evidence at completion (G7)", () => {
  test("a Change with no linked node cannot complete", () => {
    const graph = makeChangeGraph({ affected_nodes: [] })
    expect(checkSpecEvidence(graph, "CHG-001").allowed).toBe(false)
  })

  test("a linked requirement node is enough", () => {
    const graph = makeChangeGraph({ affected_nodes: ["REQ-1"] })
    addNode(graph, {
      id: "REQ-1", type: "requirement", name: "Login", status: "DRAFT", version: 1, metadata: {},
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    expect(checkSpecEvidence(graph, "CHG-001").allowed).toBe(true)
  })

  test("dangling node ids do not count as evidence", () => {
    const graph = makeChangeGraph({ affected_nodes: ["REQ-DELETED"] })
    expect(checkSpecEvidence(graph, "CHG-001").allowed).toBe(false)
  })

  test("no_requirement_impact is an explicit opt-out", () => {
    const graph = makeChangeGraph({ affected_nodes: [], no_requirement_impact: true })
    expect(checkSpecEvidence(graph, "CHG-001").allowed).toBe(true)
  })
})

describe("Executable verification waiver (G4)", () => {
  test("no declared script stays unverified", () => {
    const dir = tempDir("waiver")
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "no-scripts" }))
      const result = validateExecutableProject(dir)
      expect(result.verified).toBe(false)
      expect(result.verification_waived).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("an explicit waiver is recorded instead of forcing completion", () => {
    const dir = tempDir("waiver-ack")
    try {
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "no-scripts" }))
      const result = validateExecutableProject(dir, { acknowledgeNoScripts: true, waiverReason: "docs only" })
      expect(result.verified).toBe(true)
      expect(result.verification_waived).toBe(true)
      expect(result.waiver_reason).toBe("docs only")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("Scoped verification evidence (G6/G8)", () => {
  const base: ExecutableValidationResult = {
    passed: true,
    verified: true,
    checks: [],
    created_at: new Date().toISOString(),
    project_fingerprint: "fingerprint",
  }

  test("a report with no scope cannot be accepted", () => {
    const dir = tempDir("scoped-empty")
    try {
      expect(verifyScopedFiles(dir, base).ok).toBe(false)
      expect(verifyScopedFiles(dir, { ...base, scoped_files: [] }).ok).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("missing declared file, then edited declared file, are both rejected", () => {
    const dir = tempDir("scoped")
    try {
      mkdirSync(join(dir, "src"))
      writeFileSync(join(dir, "src/a.ts"), "a")
      expect(computeScopedFileHashes(dir, ["src/missing.ts"])[0].sha256).toBeNull()

      const scoped = computeScopedFileHashes(dir, ["src/a.ts"])
      const report = { ...base, scoped_files: scoped }
      expect(verifyScopedFiles(dir, report).ok).toBe(true)

      writeFileSync(join(dir, "src/a.ts"), "changed")
      const stale = verifyScopedFiles(dir, report)
      expect(stale.ok).toBe(false)
      expect(stale.gaps[0]).toContain("changed after verification")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("Project fingerprint (G5)", () => {
  test("config dotfiles are part of the fingerprint", () => {
    const dir = tempDir("fingerprint")
    try {
      writeFileSync(join(dir, ".eslintrc.json"), '{"rules":{}}')
      const before = computeProjectFingerprint(dir)
      writeFileSync(join(dir, ".eslintrc.json"), '{"rules":{"semi":2}}')
      expect(computeProjectFingerprint(dir)).not.toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("local secrets are still ignored", () => {
    const dir = tempDir("fingerprint-env")
    try {
      writeFileSync(join(dir, ".env"), "TOKEN=1")
      const before = computeProjectFingerprint(dir)
      writeFileSync(join(dir, ".env"), "TOKEN=2")
      expect(computeProjectFingerprint(dir)).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("Renewable workflow window", () => {
  test("renewal requires an active workflow and keeps the same Change", () => {
    const scope = workflowScope(tempDir("renew"), "session-1")
    try {
      expect(renewWorkflow(undefined, scope).renewed).toBe(false)

      markEnforced("CHG-001", scope)
      markApproved(scope)
      const renewed = renewWorkflow("CHG-001", scope)
      expect(renewed.renewed).toBe(true)
      expect(renewed.changeId).toBe("CHG-001")
      expect(getWorkflowState(scope).approved).toBe(true)
      expect(isWorkflowValid(scope).valid).toBe(true)
    } finally {
      resetWorkflowState(scope)
    }
  })

  test("a different change id is refused instead of silently switching", () => {
    const scope = workflowScope(tempDir("renew-other"), "session-1")
    try {
      markEnforced("CHG-001", scope)
      const refused = renewWorkflow("CHG-002", scope)
      expect(refused.renewed).toBe(false)
      expect(refused.changeId).toBe("CHG-001")
    } finally {
      resetWorkflowState(scope)
    }
  })

  test("an expired window is restored by renewal", async () => {
    const scope = workflowScope(tempDir("renew-expired"), "session-1")
    const previous = process.env.SDD_WORKFLOW_TTL_MS
    try {
      markEnforced("CHG-001", scope)
      process.env.SDD_WORKFLOW_TTL_MS = "1"
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(isWorkflowValid(scope).valid).toBe(false)
      expect(isWorkflowValid(scope).reason).toContain("sdd.renew_workflow")

      expect(renewWorkflow("CHG-001", scope).renewed).toBe(true)
      process.env.SDD_WORKFLOW_TTL_MS = "60000"
      expect(isWorkflowValid(scope).valid).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.SDD_WORKFLOW_TTL_MS
      else process.env.SDD_WORKFLOW_TTL_MS = previous
      resetWorkflowState(scope)
    }
  })
})

describe("Change tools honour the scope gate", () => {
  async function initialize(): Promise<{ dir: string; ctx: { directory: string; sessionID: string } }> {
    const dir = tempDir("tools")
    const ctx = { directory: dir, sessionID: `session-${Date.now()}` }
    const tools = createSddTools()
    await (tools["sdd.initialize"] as any).execute({ project_name: "Gate" }, ctx)
    return { dir, ctx }
  }

  test("create_change refuses to create a Change without affected_files", async () => {
    const { dir, ctx } = await initialize()
    try {
      const tools = createSddTools()
      const refused = await (tools["sdd.create_change"] as any).execute({ title: "T", reason: "R" }, ctx)
      expect(String(refused)).toContain("NOT created")

      const created = await (tools["sdd.create_change"] as any).execute(
        { title: "T", reason: "R", affected_files: "src/a.ts" },
        ctx,
      )
      expect(String(created)).toContain("Change created")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("approve_change blocks a Change with no declared scope unless acknowledged", async () => {
    const { dir, ctx } = await initialize()
    try {
      const tools = createSddTools()
      const created = await (tools["sdd.create_change"] as any).execute(
        { title: "T", reason: "R", acknowledge_no_files: true },
        ctx,
      )
      const changeId = String(created).match(/Change created: \*\*(CHG-\d+)\*\*/)?.[1]
      expect(changeId).toBeTruthy()

      const blocked = await (tools["sdd.approve_change"] as any).execute({ change_id: changeId }, ctx)
      expect(String(blocked)).toContain("Approval BLOCKED")

      const approved = await (tools["sdd.approve_change"] as any).execute(
        { change_id: changeId, acknowledge_no_files: true },
        ctx,
      )
      expect(String(approved)).toContain("approved")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("complete_change reports the failing conditions instead of a generic block", async () => {
    const { dir, ctx } = await initialize()
    try {
      const tools = createSddTools()
      const created = await (tools["sdd.create_change"] as any).execute(
        { title: "T", reason: "R", affected_files: "src/a.ts" },
        ctx,
      )
      const changeId = String(created).match(/Change created: \*\*(CHG-\d+)\*\*/)?.[1]
      const blocked = await (tools["sdd.complete_change"] as any).execute({ change_id: changeId }, ctx)
      expect(String(blocked)).toContain("Failing conditions")
      expect(String(blocked)).toContain("verify_implementation")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("renew_workflow refuses when no workflow is active", async () => {
    const { dir, ctx } = await initialize()
    try {
      const tools = createSddTools()
      const result = await (tools["sdd.renew_workflow"] as any).execute({}, ctx)
      expect(String(result)).toContain("NOT RENEWED")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("Change metadata carries the new declarations", () => {
  test("no_requirement_impact is persisted by createChange", () => {
    const graph = createGraph("test")
    const change = createChange(graph, {
      title: "Docs",
      reason: "Documentation only",
      affected_node_ids: [],
      new_nodes: [],
      modified_nodes: [],
      removed_node_ids: [],
      affected_files: ["README.md"],
      affected_tests: [],
      implementation_tasks: [],
      no_requirement_impact: true,
    })
    expect(change.metadata.no_requirement_impact).toBe(true)
    expect(change.metadata.affected_files).toEqual(["README.md"])
  })
})
