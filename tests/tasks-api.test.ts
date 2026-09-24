import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createGraph, addNode } from "../src/sdd/graph/engine.js"
import { YamlGraphRepository } from "../src/sdd/persistence/yaml.js"
import { SqliteGraphRepository } from "../src/sdd/persistence/sqlite.js"
import { createRepository } from "../src/sdd/persistence/repository.js"
import {
  createTask,
  getPendingIntegrationTasks,
  listTasks,
  markTaskIntegrated,
  nextTaskId,
  queryTasks,
  removeTask,
  statusToColumn,
  updateTask,
} from "../src/sdd/tasks/board.js"
import { findTaskChange, openChangeForTask } from "../src/sdd/tasks/change-bridge.js"
import { SddDashboardServer } from "../src/server/server.js"
import { runSddCommand, extractSddCommandText } from "../src/opencode/command.js"
import { createSddTools } from "../src/opencode/tools.js"

function seedGraph(projectId = "tasks-test") {
  const graph = createGraph(projectId)
  const now = new Date().toISOString()
  addNode(graph, {
    id: projectId,
    type: "project",
    name: projectId,
    status: "DRAFT",
    version: 1,
    metadata: { name: projectId },
    created_at: now,
    updated_at: now,
  } as never)
  addNode(graph, {
    id: "FEAT-001",
    type: "feature",
    name: "Login",
    status: "DRAFT",
    version: 1,
    metadata: { priority: "high" },
    created_at: now,
    updated_at: now,
  } as never)
  return graph
}

function setupYaml() {
  const dir = mkdtempSync(join(tmpdir(), "tasks-api-"))
  mkdirSync(join(dir, ".sdd"), { recursive: true })
  const repo = new YamlGraphRepository(dir)
  repo.saveGraph(seedGraph())
  return dir
}

describe("task board domain", () => {
  test("creates a task with pending integration linked to the project", () => {
    const graph = seedGraph()
    const task = createTask(graph, { name: "Add login form" })

    expect(task.type).toBe("task")
    expect(task.id).toBe("tasks-test-TASK-001")
    expect(task.status).toBe("todo")
    expect(statusToColumn(task.status)).toBe("backlog")
    expect(getPendingIntegrationTasks(graph).map((t) => t.id)).toEqual([task.id])

    const links = graph.relationships.filter((r) => r.to === task.id)
    expect(links.some((r) => r.from === "tasks-test" && r.type === "contains")).toBe(true)
  })

  test("increments the TASK id without colliding after removals", () => {
    const graph = seedGraph()
    createTask(graph, { name: "First" })
    createTask(graph, { name: "Second" })
    expect(nextTaskId(graph)).toBe("tasks-test-TASK-003")

    removeTask(graph, "tasks-test-TASK-001")
    expect(nextTaskId(graph)).toBe("tasks-test-TASK-003")
    const third = createTask(graph, { name: "Third" })
    expect(third.id).toBe("tasks-test-TASK-003")
  })

  test("rejects duplicate task names", () => {
    const graph = seedGraph()
    createTask(graph, { name: "Repeat" })
    expect(() => createTask(graph, { name: "repeat" })).toThrow(/already exists/)
  })

  test("moves a card between columns through status", () => {
    const graph = seedGraph()
    const task = createTask(graph, { name: "Move me" })
    const moved = updateTask(graph, task.id, { column: "in_progress" })

    expect(moved.status).toBe("in_progress")
    expect(statusToColumn(moved.status)).toBe("in_progress")
    expect((moved.metadata as Record<string, unknown>).board_column).toBe("in_progress")
  })

  test("marking integrated clears the pending queue", () => {
    const graph = seedGraph()
    const task = createTask(graph, { name: "Integrate me" })
    markTaskIntegrated(graph, task.id)
    expect(getPendingIntegrationTasks(graph).length).toBe(0)
    expect(listTasks(graph)[0].integration_status).toBe("integrated")
  })

  test("links a task to a feature with implements when asked", () => {
    const graph = seedGraph()
    const task = createTask(graph, { name: "Uses feature", link_to: "FEAT-001" })
    const rel = graph.relationships.find((r) => r.from === task.id && r.to === "FEAT-001")
    expect(rel?.type).toBe("implements")
  })
})

describe("task query / filters / sorting", () => {
  function seeded() {
    const graph = seedGraph()
    const now = new Date().toISOString()
    addNode(graph, {
      id: "FEAT-002", type: "feature", name: "Search", status: "DRAFT",
      version: 1, metadata: {}, created_at: now, updated_at: now,
    } as never)
    const t1 = createTask(graph, { name: "Login form", priority: "critical", files: ["src/auth.ts"], link_to: "FEAT-001" })
    const t2 = createTask(graph, { name: "Search bar", priority: "low", files: ["src/search.ts"], link_to: "FEAT-002" })
    const t3 = createTask(graph, { name: "Orphan task", priority: "high" })
    return { graph, t1, t2, t3 }
  }

  test("search matches by name, id, goal, and file", () => {
    const { graph } = seeded()
    expect(queryTasks(graph, { search: "login" }).length).toBe(1)
    expect(queryTasks(graph, { search: "TASK-001" }).length).toBe(1)
    expect(queryTasks(graph, { search: "src/auth" }).length).toBe(1)
    expect(queryTasks(graph, { search: "zzz" }).length).toBe(0)
  })

  test("link filter: linked/unlinked/node type", () => {
    const { graph } = seeded()
    expect(queryTasks(graph, { link: "linked" }).length).toBe(2)
    expect(queryTasks(graph, { link: "unlinked" }).length).toBe(1)
    expect(queryTasks(graph, { link: "feature" }).length).toBe(2)
    expect(queryTasks(graph, { link: "requirement" }).length).toBe(0)
  })

  test("integration/priority/column filters", () => {
    const { graph, t1 } = seeded()
    markTaskIntegrated(graph, t1.id)
    expect(queryTasks(graph, { integration: "integrated" }).length).toBe(1)
    expect(queryTasks(graph, { integration: "pending" }).length).toBe(2)
    expect(queryTasks(graph, { priority: "critical" }).length).toBe(1)
    expect(queryTasks(graph, { priority: "low" }).length).toBe(1)
    expect(queryTasks(graph, { column: "backlog" }).length).toBe(3)
  })

  test("sorting by priority, name, and column", () => {
    const { graph } = seeded()
    const byPriority = queryTasks(graph, { sort: "priority", order: "asc" })
    expect(byPriority[0].priority).toBe("critical")
    expect(byPriority[2].priority).toBe("low")

    const byName = queryTasks(graph, { sort: "name", order: "asc" })
    expect(byName[0].name).toBe("Login form")
    expect(byName[2].name).toBe("Search bar")

    const byCol = queryTasks(graph, { sort: "column", order: "asc" })
    expect(byCol[0].name).toBe("Login form") // backlog, then priority
  })

  test("combined filters and search", () => {
    const { graph } = seeded()
    const result = queryTasks(graph, { search: "search", link: "linked", priority: "low" })
    expect(result.length).toBe(1)
    expect(result[0].name).toBe("Search bar")
  })

  test("API passes query params through", async () => {
    const dir = setupYaml()
    const server = new SddDashboardServer(dir)
    const port = server.start(0)
    const base = `http://127.0.0.1:${port}`
    try {
      await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Filter me", priority: "critical" }),
      })
      const res = await fetch(`${base}/api/tasks?priority=critical&sort=priority`)
      const body = await res.json() as { tasks: Array<{ name: string; priority: string }>; query: Record<string, string> }
      expect(body.tasks.length).toBe(1)
      expect(body.tasks[0].priority).toBe("critical")
      expect(body.query.priority).toBe("critical")
      expect(body.query.sort).toBe("priority")
    } finally {
      server.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("task → Change bridge", () => {
  test("opens an AUTO change for the task, scopes the files and approves it", () => {
    const graph = seedGraph()
    const task = createTask(graph, {
      name: "Ship login",
      description: "Add the login form",
      files: ["src/auth.ts", "tests/auth.test.ts"],
      link_to: "FEAT-001",
    })

    const result = openChangeForTask(graph, task.id)

    expect(result.created).toBe(true)
    expect(result.approved).toBe(true)
    expect(result.change.type).toBe("change")
    expect(result.change.metadata.affected_files).toEqual(["src/auth.ts", "tests/auth.test.ts"])
    expect(result.change.metadata.affected_tests).toEqual(["tests/auth.test.ts"])
    expect(result.change.metadata.affected_nodes).toContain("FEAT-001")
    expect(result.change.metadata.implementation_tasks).toEqual([task.id])

    // The change is wired to the task so the Kanban can surface it.
    expect(graph.relationships.some((r) => r.from === result.change.id && r.to === task.id)).toBe(true)
    expect(findTaskChange(graph, task.id)?.id).toBe(result.change.id)

    const reloaded = graph.nodes.find((n) => n.id === task.id)
    expect(reloaded?.status).toBe("in_progress")
    expect((reloaded?.metadata as Record<string, unknown>).change_id).toBe(result.change.id)
  })

  test("is idempotent — a task keeps a single change", () => {
    const graph = seedGraph()
    const task = createTask(graph, { name: "Only once", files: ["src/a.ts"] })
    const first = openChangeForTask(graph, task.id)
    const second = openChangeForTask(graph, task.id)

    expect(second.created).toBe(false)
    expect(second.change.id).toBe(first.change.id)
    expect(graph.nodes.filter((n) => n.type === "change").length).toBe(1)
  })

  test("keeps the change in draft when no file scope is declared", () => {
    const graph = seedGraph()
    const task = createTask(graph, { name: "No files yet" })
    const result = openChangeForTask(graph, task.id)

    expect(result.approved).toBe(false)
    expect(result.change.status).toBe("DRAFT")
    expect(result.blockers.join(" ")).toMatch(/affected files/i)

    // Explicit approval cannot bypass an incomplete scope either.
    const forced = openChangeForTask(graph, task.id, { approve: true })
    expect(forced.approved).toBe(false)
  })

  test("approves an existing draft change on request", () => {
    const graph = seedGraph()
    const task = createTask(graph, { name: "Approve me", files: ["src/a.ts"] })
    const draft = openChangeForTask(graph, task.id, { autoApprove: false })
    expect(draft.approved).toBe(false)

    const approved = openChangeForTask(graph, task.id, { approve: true })
    expect(approved.approved).toBe(true)
    expect(approved.change.status).toBe("APPROVED")
  })

  test("rejects an unknown task", () => {
    const graph = seedGraph()
    expect(() => openChangeForTask(graph, "nope-TASK-001")).toThrow(/not found/)
  })
})

describe("dashboard task API", () => {
  let dir: string
  let server: SddDashboardServer
  let base: string

  beforeEach(() => {
    dir = setupYaml()
    server = new SddDashboardServer(dir)
    const port = server.start(0)
    base = `http://127.0.0.1:${port}`
  })

  afterEach(() => {
    server.stop()
    rmSync(dir, { recursive: true, force: true })
  })

  test("GET / serves the dashboard with a Kanban view", async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('id="kanban-board"')
    expect(html).toContain('data-view="kanban"')
    expect(html).toContain('id="task-modal"')
    expect(html).toContain("renderKanban")
    expect(html).toContain('return n.id === id ? "#ffffff" : getColor(n.type);')
    expect(html).toContain("fg.nodeOpacity(0.9);")
    expect(html).not.toContain("connectedIds.has(n.id) ? 1.0 : 0.6")

    // The static shell (everything before the first <script>) must be balanced.
    const shell = html.split("<script")[0]
    const opens = (shell.match(/<div\b/g) || []).length
    const closes = (shell.match(/<\/div>/g) || []).length
    expect(opens).toBe(closes)
  })

  test("GET /api/tasks lists columns and tasks", async () => {
    const res = await fetch(`${base}/api/tasks`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { columns: unknown[]; tasks: unknown[] }
    expect(body.columns.length).toBe(5)
    expect(body.tasks.length).toBe(0)
  })

  test("POST /api/tasks creates a card and persists it", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New card", goal: "Ship it" }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { task: { id: string } }
    expect(body.task.id).toBe("tasks-test-TASK-001")

    const repo = createRepository(dir)
    const graph = repo.loadGraph()
    expect(graph.nodes.some((n) => n.id === "tasks-test-TASK-001")).toBe(true)
  })

  test("POST /api/tasks rejects invalid payloads", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    })
    expect(res.status).toBe(400)
  })

  test("POST /api/tasks rejects duplicate names with 409", async () => {
    const payload = JSON.stringify({ name: "Dup" })
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    })
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    })
    expect(res.status).toBe(409)
  })

  test("POST /api/tasks/:id moves the card and does not re-flag integration", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Drag me" }),
    })

    const res = await fetch(`${base}/api/tasks/tasks-test-TASK-001`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ column: "done" }),
    })
    expect(res.status).toBe(200)

    const list = await fetch(`${base}/api/tasks`).then((r) => r.json())
    const task = (list as { tasks: Array<{ column: string; status: string }> }).tasks[0]
    expect(task.column).toBe("done")
    expect(task.status).toBe("completed")
  })

  test("POST /api/tasks/:id detects version conflicts", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Conflict" }),
    })
    const res = await fetch(`${base}/api/tasks/tasks-test-TASK-001`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed", expected_version: 99 }),
    })
    expect(res.status).toBe(409)
  })

  test("DELETE /api/tasks/:id removes the card", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Delete me" }),
    })
    const res = await fetch(`${base}/api/tasks/tasks-test-TASK-001`, { method: "DELETE" })
    expect(res.status).toBe(200)

    const list = await fetch(`${base}/api/tasks`).then((r) => r.json())
    expect((list as { tasks: unknown[] }).tasks.length).toBe(0)
  })

  test("POST /api/tasks/:id/change opens and persists the SDD Change", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Needs code", files: ["src/feature.ts"] }),
    })

    const res = await fetch(`${base}/api/tasks/tasks-test-TASK-001/change`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      change: { id: string; status: string; affected_files: string[] }
      approved: boolean
      blockers: string[]
      integration: { queued: boolean }
    }
    expect(body.change.id).toBe("CHG-001")
    expect(body.change.status).toBe("APPROVED")
    expect(body.change.affected_files).toEqual(["src/feature.ts"])
    expect(body.approved).toBe(true)
    expect(body.blockers.length).toBe(0)
    expect(body.integration.queued).toBe(false)

    const graph = createRepository(dir).loadGraph()
    expect(graph.nodes.some((n) => n.type === "change" && n.status === "APPROVED")).toBe(true)

    const list = (await fetch(`${base}/api/tasks`).then((r) => r.json())) as {
      tasks: Array<{ change_id?: string; change_status?: string }>
    }
    expect(list.tasks[0].change_id).toBe("CHG-001")
    expect(list.tasks[0].change_status).toBe("APPROVED")
  })

  test("POST /api/tasks/:id/change returns 404 for unknown tasks", async () => {
    const res = await fetch(`${base}/api/tasks/missing-TASK-999/change`, { method: "POST" })
    expect(res.status).toBe(404)
  })

  test("mutating routes reject a non-loopback Host header", async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Host: "evil.example.com" },
      body: JSON.stringify({ name: "Nope" }),
    })
    expect(res.status).toBe(403)
  })

  test("POST /api/tasks/:id/integrate keeps the task pending without a session", async () => {
    await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Integrate" }),
    })
    const res = await fetch(`${base}/api/tasks/tasks-test-TASK-001/integrate`, { method: "POST" })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { integration: { queued: boolean } }
    expect(body.integration.queued).toBe(false)
  })
})

describe("/sdd tasks command", () => {
  let dir: string

  beforeEach(() => {
    dir = setupYaml()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("recognizes the tasks command forms", () => {
    expect(extractSddCommandText("/sdd tasks")).toBe("sdd tasks")
    expect(extractSddCommandText("sdd tasks integrate")).toBe("sdd tasks integrate")
    expect(extractSddCommandText("sdd:tasks")).toBe("sdd:tasks")
  })

  test("reports an empty board", () => {
    const result = runSddCommand(dir, "sdd tasks")
    expect(result.matched).toBe(true)
    expect(result.text).toContain("No tasks on the board yet")
  })

  test("lists tasks and the pending integration count", () => {
    const repo = createRepository(dir)
    const graph = repo.loadGraph()
    createTask(graph, { name: "Ship kanban" })
    repo.saveGraph(graph)

    const result = runSddCommand(dir, "sdd tasks")
    expect(result.text).toContain("tasks-test-TASK-001")
    expect(result.text).toContain("Pending AI integration:** 1")
  })

  test("tasks change <ID> opens the Change and asks for approval", () => {
    const repo = createRepository(dir)
    const graph = repo.loadGraph()
    createTask(graph, { name: "Needs code" })
    repo.saveGraph(graph)

    const draft = runSddCommand(dir, "sdd tasks change tasks-test-TASK-001")
    expect(draft.text).toContain("SDD Change CHG-001")
    expect(draft.text).toContain("⏳")
    expect(draft.text).toContain("--approve")
  })

  test("tasks change <ID> --approve approves an AUTO change with files", () => {
    const repo = createRepository(dir)
    const graph = repo.loadGraph()
    createTask(graph, { name: "Needs code", files: ["src/a.ts"] })
    repo.saveGraph(graph)

    const result = runSddCommand(dir, "sdd tasks change tasks-test-TASK-001 --approve")
    expect(result.text).toContain("✅ Change aprovado")

    const reloaded = createRepository(dir).loadGraph()
    expect(reloaded.nodes.find((n) => n.type === "change")?.status).toBe("APPROVED")
  })

  test("tasks integrate shows the integration plan", () => {
    const repo = createRepository(dir)
    const graph = repo.loadGraph()
    createTask(graph, { name: "Integrate me" })
    repo.saveGraph(graph)

    const result = runSddCommand(dir, "sdd tasks integrate")
    expect(result.text).toContain("pendentes de integração")
  })
})

describe("sdd.integrate_tasks tool", () => {
  test("lists pending tasks and marks them integrated", async () => {
    const dir = setupYaml()
    try {
      const repo = createRepository(dir)
      const graph = repo.loadGraph()
      createTask(graph, { name: "Agent task" })
      repo.saveGraph(graph)

      const tools = createSddTools()
      const ctx = { directory: dir, sessionID: "test-session" }

      const listed = (await (tools["sdd.integrate_tasks"] as any).execute({ action: "list" }, ctx)) as string
      expect(listed).toContain("pendentes de integração")
      expect(listed).toContain("tasks-test-TASK-001")

      const marked = (await (tools["sdd.integrate_tasks"] as any).execute(
        { action: "mark_integrated", task_id: "tasks-test-TASK-001" },
        ctx,
      )) as string
      expect(marked).toContain("marked as integrated")
      // Integrating opens the SDD Change that authorizes the code.
      expect(marked).toContain("Change CHG-001")

      const after = (await (tools["sdd.integrate_tasks"] as any).execute({ action: "list" }, ctx)) as string
      expect(after).toContain("SDD Tasks (1)")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("open_change and approve_change actions drive the Change", async () => {
    const dir = setupYaml()
    try {
      const tools = createSddTools()
      const ctx = { directory: dir, sessionID: "test-session" }

      const created = (await (tools["sdd.integrate_tasks"] as any).execute(
        { action: "create", name: "Code target", files: "src/a.ts", column: "ready" },
        ctx,
      )) as string
      const taskId = /tasks-test-TASK-\d+/.exec(created)?.[0] as string
      expect(taskId).toBeTruthy()

      const opened = (await (tools["sdd.integrate_tasks"] as any).execute(
        { action: "open_change", task_id: taskId },
        ctx,
      )) as string
      expect(opened).toContain("Change CHG-001")
      expect(opened).toContain("✅ Change aprovado")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("creates a task from the agent", async () => {
    const dir = setupYaml()
    try {
      const tools = createSddTools()
      const ctx = { directory: dir, sessionID: "test-session" }
      const created = (await (tools["sdd.integrate_tasks"] as any).execute(
        { action: "create", name: "From agent", column: "ready" },
        ctx,
      )) as string
      expect(created).toContain("tasks-test-TASK-001")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("task persistence across backends", () => {
  test("SQLite preserves Kanban metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "tasks-sqlite-"))
    mkdirSync(join(dir, ".sdd"), { recursive: true })
    try {
      const repo = new SqliteGraphRepository(dir)
      const graph = seedGraph("sqlite-tasks")
      createTask(graph, { name: "Persist me", column: "ready", goal: "Keep metadata" })
      repo.saveGraph(graph)

      const reloaded = repo.loadGraph()
      const task = reloaded.nodes.find((n) => n.type === "task")
      expect(task?.id).toBe("sqlite-tasks-TASK-001")
      expect((task?.metadata as Record<string, unknown>).board_column).toBe("ready")
      expect((task?.metadata as Record<string, unknown>).integration_status).toBe("pending")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
