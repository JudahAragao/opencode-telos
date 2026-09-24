import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createSddTools } from "../src/opencode/tools"
import { createRepository } from "../src/sdd/persistence/repository"
import { SqliteGraphRepository } from "../src/sdd/persistence/sqlite"
import { YamlGraphRepository } from "../src/sdd/persistence/yaml"
import { createGraph } from "../src/sdd/graph/engine"
import { generateDocumentation } from "../src/sdd/documentation/generator"
import { resetWorkflowState } from "../src/sdd/enforcement/workflow-tracker"

function seedProject(dir: string): void {
  mkdirSync(join(dir, "src"), { recursive: true })
  writeFileSync(join(dir, "src", "service.ts"), [
    "export function run(input: any) {",
    "  // TODO: define the production policy",
    "  console.log(input)",
    "  try { return input.value } catch {}",
    "}",
  ].join("\n"))
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "brownfield-fixture" }))
}

describe("brownfield findings lifecycle", () => {
  let dir: string

  beforeEach(() => {
    resetWorkflowState()
    dir = mkdtempSync(join(tmpdir(), "sdd-findings-"))
    seedProject(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("documentation keeps findings open and creates remediation tasks", async () => {
    const tool = createSddTools()["sdd.reverse_engineer"] as any
    const output = await tool.execute({ purpose: "documentation", depth: "full" }, { directory: dir, sessionID: "docs-findings" })
    expect(output).toContain("Findings created")

    const graph = createRepository(dir).loadGraph()
    const findings = graph.nodes.filter((node) => node.type === "finding")
    const tasks = graph.nodes.filter((node) => node.type === "task")
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((finding) => finding.status === "open")).toBe(true)
    expect(tasks.length).toBe(findings.length)
    expect(graph.relationships.some((rel) => rel.type === "tracked_by")).toBe(true)

    const documentation = generateDocumentation(graph, { type: "architecture" })
    expect(documentation).toContain("Descobertas, Riscos e Resoluções")
    expect(documentation).toContain("Descobertas abertas")
  })

  test("documentation resolution preserves history and traceability", async () => {
    const tools = createSddTools()
    await (tools["sdd.reverse_engineer"] as any).execute({ purpose: "documentation" }, { directory: dir, sessionID: "docs-resolve" })
    const before = createRepository(dir).loadGraph()
    const finding = before.nodes.find((node) => node.type === "finding")!
    const task = before.nodes.find((node) => node.type === "task" && (node.metadata as any).finding_id === finding.id)!
    const output = await (tools["sdd.findings"] as any).execute({
      action: "resolve",
      finding_id: finding.id,
      description: "Correção aplicada e teste de regressão executado.",
      task_id: task.id,
      evidence: "test: regression-suite",
    }, { directory: dir, sessionID: "docs-resolve" })
    expect(output).toContain("resolved")

    const graph = createRepository(dir).loadGraph()
    const resolved = graph.nodes.find((node) => node.id === finding.id)!
    expect(resolved.status).toBe("resolved")
    expect((resolved.metadata as any).resolution.description).toContain("Correção aplicada")
    expect((resolved.metadata as any).history.length).toBeGreaterThan(1)
  })

  test("reverse engineering resolves source findings into target requirements", async () => {
    const tools = createSddTools()
    await (tools["sdd.reverse_engineer"] as any).execute({ purpose: "reverse_engineering" }, { directory: dir, sessionID: "reverse-findings" })
    const graph = createRepository(dir).loadGraph()
    const findings = graph.nodes.filter((node) => node.type === "finding")
    const targetRequirements = graph.nodes.filter((node) => node.type === "requirement" && (node.metadata as any).source_purpose === "reverse_engineering")
    const targetTasks = graph.nodes.filter((node) => node.type === "task" && (node.metadata as any).purpose === "reverse_engineering")

    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((finding) => ["resolved", "closed", "accepted"].includes(finding.status))).toBe(true)
    expect(targetRequirements.length).toBe(findings.length)
    expect(targetTasks.length).toBeGreaterThan(0)
    expect(graph.relationships.some((rel) => rel.type === "derived_from")).toBe(true)
    expect(graph.relationships.some((rel) => rel.type === "resolves")).toBe(true)
    expect(targetTasks.every((task) => !(task.metadata as any).files?.length)).toBe(true)
  })

  test("reverse engineering blocks implementation when a critical finding is reopened", async () => {
    const tools = createSddTools()
    await (tools["sdd.reverse_engineer"] as any).execute({ purpose: "reverse_engineering" }, { directory: dir, sessionID: "reverse-gate" })
    const graph = createRepository(dir).loadGraph()
    const finding = graph.nodes.find((node) => node.type === "finding" && (node.metadata as any).severity === "high")!
    await (tools["sdd.findings"] as any).execute({
      action: "transition",
      finding_id: finding.id,
      status: "open",
      description: "A evidência alvo foi invalidada para testar o gate.",
    }, { directory: dir, sessionID: "reverse-gate" })
    const output = await (tools["sdd.enforce"] as any).execute({
      request_description: "implementar a nova versão",
      affected_files: "src/service.ts",
    }, { directory: dir, sessionID: "reverse-gate" })
    expect(output).toContain("SDD Enforcement: BLOCKED")
    expect(output).toContain(finding.id)
  })
})

describe("finding persistence parity", () => {
  for (const [name, Repository] of [["yaml", YamlGraphRepository], ["sqlite", SqliteGraphRepository]] as const) {
    test(`${name} stores finding nodes and semantic relations`, () => {
      const dir = mkdtempSync(join(tmpdir(), `sdd-findings-${name}-`))
      try {
        const repo = new Repository(dir)
        const graph = createGraph(`${name}-project`)
        graph.nodes.push({
          id: graph.project_id,
          type: "project",
          name: "Project",
          status: "DRAFT",
          version: 1,
          metadata: { name: "Project" },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        graph.nodes.push({
          id: "FND-test",
          type: "finding",
          name: "Fixture finding",
          description: "Observed issue",
          status: "open",
          version: 1,
          metadata: {
            fingerprint: "test",
            category: "quality",
            severity: "low",
            title: "Fixture finding",
            observed_behavior: "Observed issue",
            purpose: "documentation",
            confidence: 1,
            evidence: [],
            source_files: [],
            source_node_ids: [],
            history: [{ status: "open", at: new Date().toISOString() }],
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
        graph.relationships.push({ id: "rel", from: graph.project_id, to: "FND-test", type: "contains", metadata: {} })
        repo.saveGraph(graph)
        const loaded = repo.loadGraph()
        expect(loaded.nodes.some((node) => node.type === "finding")).toBe(true)
        expect(loaded.relationships.some((rel) => rel.type === "contains" && rel.to === "FND-test")).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
