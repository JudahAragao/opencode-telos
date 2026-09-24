import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createSddTools } from "../src/opencode/tools.js"
import { createRepository } from "../src/sdd/persistence/repository.js"
import { SqliteGraphRepository } from "../src/sdd/persistence/sqlite.js"
import { validateGraph } from "../src/sdd/validation/validator.js"

const BRIEFING = `
# Task platform

## 1. Authentication
Users must log in with email and password.

## 2. Task management
Users can create, edit, complete, and delete tasks.
`

async function bootstrap(directory: string): Promise<{ output: string; graph: ReturnType<ReturnType<typeof createRepository>["loadGraph"]> }> {
  const tools = createSddTools()
  const context = { directory, sessionID: "bootstrap-test" }
  const discover = await (tools["sdd.discover"] as any).execute({ briefing: BRIEFING }, context) as string
  expect(discover).toContain("sdd.update_from_answers")
  expect(discover).toContain("question")

  const output = await (tools["sdd.update_from_answers"] as any).execute(
    { answers_json: "{}", briefing: BRIEFING },
    context,
  ) as string
  return { output, graph: createRepository(directory).loadGraph() }
}

describe("initial briefing bootstrap", () => {
  test("asks discovery questions, creates tasks, and persists YAML idempotently", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sdd-bootstrap-yaml-"))
    try {
      const first = await bootstrap(directory)
      expect(first.output).toContain("**task:**")
      const tasks = first.graph.nodes.filter((node) => node.type === "task")
      const requirements = first.graph.nodes.filter((node) => node.type === "requirement")
      expect(requirements.length).toBeGreaterThan(0)
      expect(tasks.length).toBeGreaterThan(0)
      expect(tasks.every((task) => task.metadata.integration_status === "pending")).toBe(true)

      const second = await bootstrap(directory)
      expect(second.graph.nodes.filter((node) => node.type === "task").length).toBe(tasks.length)
      expect(validateGraph(second.graph).warnings.some((warning) => warning.code === "REQUIREMENT_NO_TASK")).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("uses the active SQLite backend and preserves generated tasks", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sdd-bootstrap-sqlite-"))
    try {
      new SqliteGraphRepository(directory).createProject("project", "Project", BRIEFING, "greenfield")
      const result = await bootstrap(directory)
      const repository = createRepository(directory)
      expect(repository.getStorageType()).toBe("sqlite")
      expect(result.graph.nodes.some((node) => node.type === "task")).toBe(true)
      expect(result.graph.nodes.some((node) => node.type === "requirement")).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
