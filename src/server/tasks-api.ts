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
  TASK_PRIORITY_LABELS,
  TASK_PRIORITIES,
  TASK_SORT_KEYS,
  createTask,
  getTask,
  queryTasks,
  markTaskIntegrated,
  removeTask,
  updateTask,
  type TaskColumn,
  type TaskPriority,
  type TaskSortKey,
  type TaskSortOrder,
} from "../sdd/tasks/board.js"
import {
  buildChangeImplementationPrompt,
  openChangeForTask,
} from "../sdd/tasks/change-bridge.js"
import { requestAgentTurn, requestTaskIntegration } from "./dashboard-context.js"
import { sddDebug } from "../sdd/log.js"

export interface TasksApiResult {
  status: number
  body: unknown
}

const columnSchema = z.enum(["backlog", "ready", "in_progress", "blocked", "done"])
const prioritySchema = z.enum(["critical", "high", "medium", "low"])

const createTaskSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(8000).optional(),
  goal: z.string().max(4000).optional(),
  files: z.array(z.string().min(1).max(500)).max(200).optional(),
  acceptance: z.array(z.string().min(1).max(2000)).max(200).optional(),
  column: columnSchema.optional(),
  priority: prioritySchema.optional(),
  link_to: z.string().min(1).max(300).optional(),
  link_type: z.string().min(1).max(60).optional(),
})

const openChangeSchema = z.object({
  files: z.array(z.string().min(1).max(500)).max(200).optional(),
  approve: z.boolean().optional(),
  auto_approve: z.boolean().optional(),
  no_requirement_impact: z.boolean().optional(),
})

const updateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(8000).optional(),
  goal: z.string().max(4000).optional(),
  files: z.array(z.string().min(1).max(500)).max(200).optional(),
  acceptance: z.array(z.string().min(1).max(2000)).max(200).optional(),
  column: columnSchema.optional(),
  priority: prioritySchema.optional(),
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

export function handleListTasks(
  projectDir: string,
  query: Record<string, string> = {},
): TasksApiResult {
  try {
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return notInitialized()
    const graph = repo.loadGraph()
    const search = (query.q ?? "").slice(0, 200)
    const sort = TASK_SORT_KEYS.includes(query.sort as TaskSortKey) ? (query.sort as TaskSortKey) : undefined
    const order = query.order === "desc" || query.order === "asc" ? (query.order as TaskSortOrder) : undefined
    const column = TASK_COLUMNS.includes(query.column as TaskColumn) ? (query.column as TaskColumn) : undefined
    const integration = ["all", "pending", "integrated", "manual"].includes(query.integration) ? query.integration : undefined
    const priority = TASK_PRIORITIES.includes(query.priority as TaskPriority) || query.priority === "all" ? (query.priority as "all" | TaskPriority) : undefined
    const link = query.link ? query.link : undefined

    const tasks = queryTasks(graph, {
      search: search || undefined,
      sort,
      order,
      column,
      integration: integration as "all" | undefined,
      priority,
      link,
    })

    return {
      status: 200,
      body: {
        project_id: graph.project_id,
        columns: TASK_COLUMNS.map((id) => ({ id, label: TASK_COLUMN_LABELS[id] })),
        priorities: TASK_PRIORITIES.map((p) => ({ id: p, label: TASK_PRIORITY_LABELS[p] })),
        tasks,
        query: { q: search, sort: sort ?? "column", order: order ?? "asc", column: column ?? "all", integration: integration ?? "all", priority: priority ?? "all", link: link ?? "all" },
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
      priority: parsed.data.priority as TaskPriority | undefined,
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
      priority: data.priority as TaskPriority | undefined,
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

/**
 * Open (or return) the SDD Change that authorizes the code of a task.
 *
 * When the Change ends up APPROVED the agent is asked to implement it — the
 * dashboard never writes source code itself.
 */
export function handleOpenChange(projectDir: string, id: string, raw: unknown): TasksApiResult {
  const parsed = openChangeSchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid change payload", issues: parsed.error.issues } }
  }

  try {
    const repo = createRepository(projectDir)
    if (!repo.isInitialized()) return notInitialized()
    const graph = repo.loadGraph()

    if (!getTask(graph, id)) {
      return { status: 404, body: { error: `Task ${id} not found` } }
    }

    const result = openChangeForTask(graph, id, {
      files: parsed.data.files,
      approve: parsed.data.approve,
      autoApprove: parsed.data.auto_approve,
      noRequirementImpact: parsed.data.no_requirement_impact,
    })
    repo.saveGraph(graph)

    const task = getTask(graph, id)
    const integration = result.approved && task
      ? requestAgentTurn(
          buildChangeImplementationPrompt(result.change, task),
          "change implementation",
        )
      : {
          queued: false,
          reason: result.blockers[0] ?? "Change created without approval.",
        }

    return {
      status: 200,
      body: {
        change: {
          id: result.change.id,
          title: result.change.metadata.title,
          status: result.change.status,
          approval_level: result.approval_level,
          affected_files: result.affected_files,
          affected_nodes: result.affected_nodes,
        },
        created: result.created,
        approved: result.approved,
        blockers: result.blockers,
        warnings: result.warnings,
        integration,
      },
    }
  } catch (error) {
    sddDebug("tasks-api", `open change failed: ${String(error)}`)
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
