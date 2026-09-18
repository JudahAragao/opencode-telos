/**
 * HTTP layer for the Kanban task API exposed by the dashboard server.
 *
 * Validation lives here (zod) and persistence goes through the same repository
 * used by the SDD tools, so `.sdd/` stays the single source of truth. Mutations
 * only ever touch the graph — they never write source files, which is why the
 * write hook does not need to intervene.
 */

import { z } from "zod"
import { createRepository } from "../sdd/persistence/repository.js"
import {
  TASK_COLUMNS,
  TASK_COLUMN_LABELS,
  createTask,
  getTask,
  listTasks,
  markTaskIntegrated,
  removeTask,
  updateTask,
  type TaskColumn,
} from "../sdd/tasks/board.js"
import { requestTaskIntegration } from "./dashboard-context.js"
import { sddDebug } from "../sdd/log.js"

export interface TasksApiResult {
  status: number
  body: unknown
}

const columnSchema = z.enum(["backlog", "ready", "in_progress", "blocked", "done"])

const createTaskSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  goal: z.string().max(4000).optional(),
  files: z.array(z.string().min(1).max(500)).max(200).optional(),
  acceptance: z.array(z.string().min(1).max(2000)).max(200).optional(),
  column: columnSchema.optional(),
  link_to: z.string().min(1).max(300).optional(),
  link_type: z.string().min(1).max(60).optional(),
})

const updateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(8000).optional(),
  goal: z.string().max(4000).optional(),
  files: z.array(z.string().min(1).max(500)).max(200).optional(),
  acceptance: z.array(z.string().min(1).max(2000)).max(200).optional(),
  column: columnSchema.optional(),
  status: z.string().min(1).max(40).optional(),
  metadata: z.record(z.unknown()).optional(),
  expected_version: z.number().int().nonnegative().optional(),
})

function classifyError(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error)
  if (/not found/i.test(message)) return 404
  if (/already exists/i.test(message)) return 409
  if (/version conflict/i.test(message)) return 409
  if (/another process is writing/i.test(message)) return 409
  return 500
}

function errorBody(error: unknown): { error: string } {
  return { error: error instanceof Error ? error.message : String(error) }
}

function notInitialized(): TasksApiResult {
  return { status: 503, body: { error: "SDD not initialized" } }
}

export function handleListTasks(projectDir: string): TasksApiResult {
  try {
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return notInitialized()
    const graph = repo.loadGraph()
    return {
      status: 200,
      body: {
        project_id: graph.project_id,
        columns: TASK_COLUMNS.map((id) => ({ id, label: TASK_COLUMN_LABELS[id] })),
        tasks: listTasks(graph),
      },
    }
  } catch (error) {
    sddDebug("tasks-api", `list failed: ${String(error)}`)
    return { status: classifyError(error), body: errorBody(error) }
  }
}

export function handleCreateTask(projectDir: string, raw: unknown): TasksApiResult {
  const parsed = createTaskSchema.safeParse(raw)
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid task payload", issues: parsed.error.issues } }
  }

  try {
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return notInitialized()
    const graph = repo.loadGraph()

    const task = createTask(graph, {
      name: parsed.data.name,
      description: parsed.data.description,
      goal: parsed.data.goal,
      files: parsed.data.files,
      acceptance: parsed.data.acceptance,
      column: parsed.data.column as TaskColumn | undefined,
      link_to: parsed.data.link_to,
      link_type: parsed.data.link_type as never,
      origin: "dashboard",
    })

    repo.saveGraph(graph)

    const integration = taskIntegrationTrigger(task.id, task.name)
    return {
      status: 201,
      body: { task: { id: task.id, name: task.name, status: task.status }, integration },
    }
  } catch (error) {
    sddDebug("tasks-api", `create failed: ${String(error)}`)
    return { status: classifyError(error), body: errorBody(error) }
  }
}

export function handleUpdateTask(projectDir: string, id: string, raw: unknown): TasksApiResult {
  const parsed = updateTaskSchema.safeParse(raw)
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid task payload", issues: parsed.error.issues } }
  }

  try {
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return notInitialized()
    const graph = repo.loadGraph()

    if (!getTask(graph, id)) {
      return { status: 404, body: { error: `Task ${id} not found` } }
    }

    const data = parsed.data
    // Moving a card is a board-only action; editing content re-flags the task
    // for AI integration.
    const contentChanged =
      data.name !== undefined ||
      data.description !== undefined ||
      data.goal !== undefined ||
      data.files !== undefined ||
      data.acceptance !== undefined ||
      data.metadata !== undefined

    const task = updateTask(graph, id, {
      name: data.name,
      description: data.description,
      goal: data.goal,
      files: data.files,
      acceptance: data.acceptance,
      column: data.column as TaskColumn | undefined,
      status: data.status as never,
      metadata: data.metadata,
      markPending: contentChanged,
      expected_version: data.expected_version,
    })

    repo.saveGraph(graph)

    const integration = contentChanged
      ? taskIntegrationTrigger(task.id, task.name)
      : { queued: false, reason: "Board move only — integration not requested." }

    return {
      status: 200,
      body: { task: { id: task.id, name: task.name, status: task.status }, integration },
    }
  } catch (error) {
    sddDebug("tasks-api", `update failed: ${String(error)}`)
    return { status: classifyError(error), body: errorBody(error) }
  }
}

export function handleDeleteTask(projectDir: string, id: string): TasksApiResult {
  try {
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return notInitialized()
    const graph = repo.loadGraph()
    removeTask(graph, id)
    repo.saveGraph(graph)
    return { status: 200, body: { removed: id } }
  } catch (error) {
    sddDebug("tasks-api", `delete failed: ${String(error)}`)
    return { status: classifyError(error), body: errorBody(error) }
  }
}

export function handleIntegrateTask(projectDir: string, id: string): TasksApiResult {
  try {
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return notInitialized()
    const graph = repo.loadGraph()

    const task = getTask(graph, id)
    if (!task) return { status: 404, body: { error: `Task ${id} not found` } }

    const updated = updateTask(graph, id, { markPending: true })
    repo.saveGraph(graph)

    const integration = taskIntegrationTrigger(updated.id, updated.name)
    return { status: 200, body: { task: { id: updated.id, name: updated.name }, integration } }
  } catch (error) {
    sddDebug("tasks-api", `integrate failed: ${String(error)}`)
    return { status: classifyError(error), body: errorBody(error) }
  }
}

/** Mark a task as integrated (called by the agent tool once it is done). */
export function handleMarkIntegrated(projectDir: string, id: string): TasksApiResult {
  try {
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return notInitialized()
    const graph = repo.loadGraph()
    const task = markTaskIntegrated(graph, id)
    repo.saveGraph(graph)
    return { status: 200, body: { task: { id: task.id, name: task.name } } }
  } catch (error) {
    sddDebug("tasks-api", `mark integrated failed: ${String(error)}`)
    return { status: classifyError(error), body: errorBody(error) }
  }
}

function taskIntegrationTrigger(
  taskId: string,
  name: string,
): { queued: boolean; reason: string } {
  try {
    return requestTaskIntegration(taskId, name)
  } catch (error) {
    return { queued: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
