import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createSddTools } from "../src/opencode/tools.js"
import { checkToolAccess, resetWorkflowState } from "../src/sdd/enforcement/workflow-tracker.js"
import { createRepository } from "../src/sdd/persistence/repository.js"

/**
 * Reverse engineering is a graph bootstrap: it must be callable from a clean
 * checkout without an active Change. These tests exercise both the standalone
 * tool and the chain that orchestrates it, so a regression in the enforcement
 * policy (which historically denied them with "not classified") fails fast.
 */

function seedProject(dir: string): void {
  mkdirSync(join(dir, "src", "api"), { recursive: true })
  mkdirSync(join(dir, "src", "models"), { recursive: true })

  writeFileSync(
    join(dir, "src", "api", "users.ts"),
    [
      "// REST API for users",
      "export async function listUsers(): Promise<User[]> {",
      "  return db.user.findMany()",
      "}",
      "",
      "export async function createUser(input: { email: string; name: string }): Promise<User> {",
      "  return db.user.create({ data: input })",
      "}",
    ].join("\n"),
  )

  writeFileSync(
    join(dir, "src", "models", "user.ts"),
    [
      "export interface User {",
      "  id: string",
      "  email: string",
      "  name: string",
      "  createdAt: string",
      "}",
    ].join("\n"),
  )

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "sample", version: "1.0.0", dependencies: { express: "^4.0.0" } }, null, 2),
  )
}

describe("reverse engineering flow", () => {
  let dir: string

  beforeEach(() => {
    resetWorkflowState()
    dir = mkdtempSync(join(tmpdir(), "sdd-reverse-"))
    seedProject(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("the enforcement policy lets reverse engineering bootstrap from zero", () => {
    // Sem Change ativo: precisa passar. É o mesmo contrato de sdd.build_graph.
    expect(checkToolAccess("sdd.reverse_engineer").allowed).toBe(true)
    expect(checkToolAccess("sdd.workflow_reverse_engineer").allowed).toBe(true)
  })

  test("sdd.reverse_engineer scans the codebase and builds the graph", async () => {
    const tools = createSddTools()
    const ctx = { directory: dir, sessionID: "reverse-session" }
    const tool = tools["sdd.reverse_engineer"]
    expect(tool).toBeDefined()

    const output = (await (tool as any).execute(
      { purpose: "reverse_engineering", depth: "full" },
      ctx,
    )) as string

    expect(output).toContain("Graph Updated")

    const repo = createRepository(dir)
    expect(repo.isInitialized()).toBe(true)
    const graph = repo.loadGraph()

    // O grafo precisa ter sido realmente populado, não apenas criado.
    expect(graph.nodes.length).toBeGreaterThan(1)
    expect(graph.metadata.purpose).toBe("reverse_engineering")
    const projectNode = graph.nodes.find((n) => n.type === "project")
    expect(projectNode?.metadata.purpose).toBe("reverse_engineering")

    // A montagem do grafo roda a inferência de rastreabilidade: as arestas
    // semânticas precisam ter sido avaliadas (mesmo que o sample seja pequeno).
    const semantic = new Set(["specifies", "implements", "operates_on", "belongs_to"])
    expect(graph.relationships.every((r) => typeof r.type === "string")).toBe(true)
    expect(graph.relationships.every((r) => !semantic.has(r.type) || graph.nodes.some((n) => n.id === r.to))).toBe(true)
  })

  test("the sdd.workflow_reverse_engineer chain runs end-to-end", async () => {
    const tools = createSddTools()
    const ctx = { directory: dir, sessionID: "reverse-chain" }
    const chain = tools["sdd.workflow_reverse_engineer"]
    expect(chain).toBeDefined()

    const output = (await (chain as any).execute(
      { purpose: "reverse_engineering" },
      ctx,
    )) as string

    // A chain não pode devolver erro de acesso nem falhar em um step required.
    expect(output).not.toContain("not classified")
    expect(output).not.toContain("requires an active SDD workflow")

    const repo = createRepository(dir)
    expect(repo.isInitialized()).toBe(true)
    expect(repo.loadGraph().nodes.length).toBeGreaterThan(1)
  })
})
