/**
 * Task board domain — Kanban view over `task` nodes without changing the SDD
 * schema.
 *
 * Everything here operates on the existing Knowledge Graph:
 *   - node type `task` (already part of `NodeType` / `TaskNode`);
 *   - statuses already present in `NodeStatus` (`todo`, `ready`, `in_progress`,
 *     `blocked`, `completed`, plus the lifecycle ones);
 *   - existing relationship types (`contains`, `implements`, `depends_on`,
 *     `blocked_by`, `tested_by`).
 *
 * The only new surface is metadata on the task node (`metadata` is an open
 * `Record<string, unknown>` in both YAML and SQLite backends), used to persist
 * the Kanban column and the AI-integration state.
 */

import type {
  AnyNode,
  KnowledgeGraph,
  NodeStatus,
  RelationshipType,
  TaskNode,
} from "../domain/types.js"
import { addNode, addRelationship, getNode, removeNode, updateNode } from "../graph/engine.js"

export type TaskColumn = "backlog" | "ready" | "in_progress" | "blocked" | "done"

export type IntegrationStatus = "pending" | "integrated" | "manual"

export type TaskPriority = "critical" | "high" | "medium" | "low"

export const TASK_PRIORITIES: readonly TaskPriority[] = ["critical", "high", "medium", "low"]

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
}

const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)
}

export function taskPriority(task: TaskNode): TaskPriority {
  const value = (task.metadata as Record<string, unknown>).priority
  return isTaskPriority(value) ? value : "medium"
}

export const TASK_COLUMNS: readonly TaskColumn[] = [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "done",
]

export const TASK_COLUMN_LABELS: Record<TaskColumn, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
}

const COLUMN_STATUS: Record<TaskColumn, NodeStatus> = {
  backlog: "todo",
  ready: "ready",
  in_progress: "in_progress",
  blocked: "blocked",
  done: "completed",
}

const STATUS_COLUMN: Record<string, TaskColumn> = {
  DRAFT: "backlog",
  PROPOSED: "backlog",
  todo: "backlog",
  ready: "ready",
  APPROVED: "ready",
  in_progress: "in_progress",
  IMPLEMENTING: "in_progress",
  VERIFYING: "in_progress",
  blocked: "blocked",
  BLOCKED: "blocked",
  CONFLICT: "blocked",
  FAILED: "blocked",
  DRIFTED: "blocked",
  completed: "done",
  COMPLETED: "done",
  IMPLEMENTED: "done",
  VERIFIED: "done",
  DEPRECATED: "done",
  ROLLED_BACK: "done",
}

export function isTaskColumn(value: unknown): value is TaskColumn {
  return typeof value === "string" && (TASK_COLUMNS as readonly string[]).includes(value)
}

/** Map any SDD status to the Kanban column it belongs to. */
export function statusToColumn(status: NodeStatus | string): TaskColumn {
  return STATUS_COLUMN[status] ?? "backlog"
}

/** Canonical status for a Kanban column (used when a card is dropped). */
export function columnToStatus(column: TaskColumn): NodeStatus {
  return COLUMN_STATUS[column] ?? "todo"
}

export function getTaskNodes(graph: KnowledgeGraph): TaskNode[] {
  return graph.nodes.filter((n) => n.type === "task") as TaskNode[]
}

export function getTask(graph: KnowledgeGraph, id: string): TaskNode | undefined {
  const node = getNode(graph, id)
  return node && node.type === "task" ? (node as TaskNode) : undefined
}

/**
 * Next `TASK-###` id, matching the format produced by `sdd.add_node`
 * (`${project_id}-TASK-001`). Scans for the highest existing suffix instead of
 * counting nodes so removals never cause a collision.
 */
export function nextTaskId(graph: KnowledgeGraph): string {
  const prefix = `${graph.project_id}-TASK-`
  let max = 0
  for (const node of graph.nodes) {
    if (!node.id.startsWith(prefix)) continue
    const suffix = Number.parseInt(node.id.slice(prefix.length), 10)
    if (Number.isInteger(suffix) && suffix > max) max = suffix
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`
}

export interface TaskLink {
  id: string
  type: RelationshipType
  direction: "outgoing" | "incoming"
  node_id: string
  node_type?: string
  node_name?: string
}

export interface TaskBoardItem {
  id: string
  name: string
  description?: string
  status: NodeStatus
  column: TaskColumn
  version: number
  metadata: Record<string, unknown>
  integration_status: IntegrationStatus
  priority: TaskPriority
  /** Change SDD aberto por esta task, quando existir. */
  change_id?: string
  change_status?: NodeStatus
  created_at: string
  updated_at: string
  links: TaskLink[]
}

export function taskIntegrationStatus(task: TaskNode): IntegrationStatus {
  const value = (task.metadata as Record<string, unknown>).integration_status
  return value === "pending" || value === "integrated" ? value : "manual"
}

export function toTaskBoardItem(graph: KnowledgeGraph, task: TaskNode): TaskBoardItem {
  const links: TaskLink[] = []
  for (const rel of graph.relationships) {
    if (rel.from !== task.id && rel.to !== task.id) continue
    const otherId = rel.from === task.id ? rel.to : rel.from
    const other = getNode(graph, otherId)
    links.push({
      id: rel.id,
      type: rel.type,
      direction: rel.from === task.id ? "outgoing" : "incoming",
      node_id: otherId,
      node_type: other?.type,
      node_name: other?.name,
    })
  }

  const metadata = { ...(task.metadata as Record<string, unknown>) }
  const declaredChange = typeof metadata.change_id === "string" ? metadata.change_id : undefined
  const change = declaredChange ? getNode(graph, declaredChange) : undefined
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    status: task.status,
    column: statusToColumn(task.status),
    version: task.version,
    metadata,
    integration_status: taskIntegrationStatus(task),
    priority: taskPriority(task),
    change_id: change?.type === "change" ? change.id : undefined,
    change_status: change?.type === "change" ? change.status : undefined,
    created_at: task.created_at,
    updated_at: task.updated_at,
    links,
  }
}

export function listTasks(graph: KnowledgeGraph): TaskBoardItem[] {
  return queryTasks(graph, {})
}

// ── Filtering, search and sorting ───────────────────────────────────────

export type TaskSortKey = "column" | "priority" | "name" | "created" | "updated" | "links" | "integration"

export const TASK_SORT_KEYS: readonly TaskSortKey[] = [
  "column", "priority", "name", "created", "updated", "links", "integration",
]

export type TaskSortOrder = "asc" | "desc"

export interface TaskQuery {
  /** Free-text search on id, name, description, goal, files, acceptance, and linked node names. */
  search?: string
  /** Filter by link status: "all", "linked", "unlinked", or a node type (feature, requirement, …). */
  link?: string
  /** Filter by integration status. */
  integration?: "all" | IntegrationStatus
  /** Filter by priority. */
  priority?: "all" | TaskPriority
  /** Filter by Kanban column. */
  column?: "all" | TaskColumn
  /** Sort key (default: "column"). */
  sort?: TaskSortKey
  /** Sort direction (default varies by key). */
  order?: TaskSortOrder
}

function matchesSearch(item: TaskBoardItem, q: string): boolean {
  const hay = [
    item.id,
    item.name,
    item.description ?? "",
    String(item.metadata.goal ?? ""),
    ...(Array.isArray(item.metadata.files) ? item.metadata.files : []),
    ...(Array.isArray(item.metadata.acceptance) ? item.metadata.acceptance : []),
    ...item.links.map((l) => l.node_id),
    ...item.links.map((l) => l.node_name ?? ""),
  ].join(" ").toLowerCase()
  return hay.includes(q)
}

function meaningfulLinks(item: TaskBoardItem): TaskLink[] {
  return item.links.filter((l) => l.type !== "contains")
}

function matchesLinkFilter(item: TaskBoardItem, filter: string): boolean {
  if (filter === "all") return true
  const meaningful = meaningfulLinks(item)
  if (filter === "linked") return meaningful.length > 0
  if (filter === "unlinked") return meaningful.length === 0
  return meaningful.some((l) => l.node_type === filter)
}

function defaultOrder(key: TaskSortKey): TaskSortOrder {
  return key === "updated" || key === "created" ? "desc" : "asc"
}

function sortItems(items: TaskBoardItem[], sortKey: TaskSortKey, order: TaskSortOrder): TaskBoardItem[] {
  const dir = order === "desc" ? -1 : 1
  const columnIndex = (item: TaskBoardItem) => TASK_COLUMNS.indexOf(item.column)
  const integrationWeight = (item: TaskBoardItem) =>
    item.integration_status === "pending" ? 0 : item.integration_status === "manual" ? 1 : 2

  const sorted = [...items].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case "priority":
        cmp = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
        break
      case "name":
        cmp = a.name.localeCompare(b.name)
        break
      case "created":
        cmp = a.created_at.localeCompare(b.created_at)
        break
      case "updated":
        cmp = a.updated_at.localeCompare(b.updated_at)
        break
      case "links":
        cmp = a.links.length - b.links.length
        break
      case "integration":
        cmp = integrationWeight(a) - integrationWeight(b)
        break
      default: {
        // "column" — primary by column order, then priority, then name
        cmp = columnIndex(a) - columnIndex(b)
        if (cmp === 0) cmp = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
        if (cmp === 0) cmp = a.name.localeCompare(b.name)
        return cmp
      }
    }
    if (cmp !== 0) return cmp * dir
    // Stable tiebreakers
    const colCmp = columnIndex(a) - columnIndex(b)
    if (colCmp !== 0) return colCmp
    return a.name.localeCompare(b.name)
  })
  return sorted
}

export function queryTasks(graph: KnowledgeGraph, query: TaskQuery = {}): TaskBoardItem[] {
  const search = (query.search ?? "").trim().toLowerCase().slice(0, 200)
  const link = (query.link ?? "all").trim()
  const integration = query.integration ?? "all"
  const priority = query.priority ?? "all"
  const column = query.column ?? "all"
  const sortKey: TaskSortKey = (query.sort as TaskSortKey) ?? "column"
  const order: TaskSortOrder = query.order ?? defaultOrder(sortKey)

  let items = getTaskNodes(graph).map((task) => toTaskBoardItem(graph, task))

  if (search) items = items.filter((item) => matchesSearch(item, search))
  if (link !== "all") items = items.filter((item) => matchesLinkFilter(item, link))
  if (integration !== "all") items = items.filter((item) => item.integration_status === integration)
  if (priority !== "all") items = items.filter((item) => item.priority === priority)
  if (column !== "all") items = items.filter((item) => item.column === column)

  return sortItems(items, sortKey, order)
}

export interface CreateTaskInput {
  name: string
  description?: string
  goal?: string
  files?: string[]
  acceptance?: string[]
  column?: TaskColumn
  status?: NodeStatus
  priority?: TaskPriority
  link_to?: string
  link_type?: RelationshipType
  origin?: string
  integration_status?: IntegrationStatus
}

function linkTask(
  graph: KnowledgeGraph,
  task: TaskNode,
  linkTo?: string,
  linkType?: RelationshipType,
): void {
  if (linkTo) {
    const target = getNode(graph, linkTo)
    if (target) {
      const type: RelationshipType =
        linkType ?? (target.type === "project" ? "contains" : "implements")
      if (type === "contains") {
        addRelationship(graph, target.id, task.id, "contains")
      } else {
        addRelationship(graph, task.id, target.id, type)
      }
      return
    }
  }

  // Keep the task connected to the project root so a manual card never becomes
  // an orphan (which the integrity/health checks would flag).
  const project = getNode(graph, graph.project_id)
  if (project && project.id !== task.id) {
    try {
      addRelationship(graph, project.id, task.id, "contains")
    } catch {
      // Already linked or cycle rule — nothing to repair.
    }
  }
}

export function createTask(graph: KnowledgeGraph, input: CreateTaskInput): TaskNode {
  const name = (input.name ?? "").trim()
  if (!name) throw new Error("Task name is required")

  const duplicate = getTaskNodes(graph).find((t) => t.name.toLowerCase() === name.toLowerCase())
  if (duplicate) {
    throw new Error(`Task "${name}" already exists (${duplicate.id})`)
  }

  const column = input.column ?? statusToColumn(input.status ?? "todo")
  const status = input.status ?? columnToStatus(column)
  const now = new Date().toISOString()

  const metadata: Record<string, unknown> = {
    board_column: column,
    integration_status: input.integration_status ?? "pending",
    origin: input.origin ?? "dashboard",
    created_from: "dashboard",
  }
  if (input.goal) metadata.goal = input.goal
  if (input.files?.length) metadata.files = input.files
  if (input.acceptance?.length) metadata.acceptance = input.acceptance
  if (isTaskPriority(input.priority)) metadata.priority = input.priority

  const node: TaskNode = {
    id: nextTaskId(graph),
    type: "task",
    name,
    description: input.description,
    status,
    version: 1,
    metadata: metadata as TaskNode["metadata"],
    created_at: now,
    updated_at: now,
  }

  addNode(graph, node)
  linkTask(graph, node, input.link_to, input.link_type)
  return node
}

export interface UpdateTaskInput {
  name?: string
  description?: string
  goal?: string
  files?: string[]
  acceptance?: string[]
  status?: NodeStatus
  column?: TaskColumn
  priority?: TaskPriority
  metadata?: Record<string, unknown>
  /** Re-flag the task for AI integration (content changed). */
  markPending?: boolean
  expected_version?: number
}

export function updateTask(graph: KnowledgeGraph, id: string, input: UpdateTaskInput): TaskNode {
  const task = getTask(graph, id)
  if (!task) throw new Error(`Task ${id} not found`)

  if (input.expected_version !== undefined && task.version !== input.expected_version) {
    throw new Error(
      `Version conflict on ${id}: expected ${input.expected_version}, found ${task.version}`,
    )
  }

  const updates: Partial<AnyNode> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new Error("Task name cannot be empty")
    const duplicate = getTaskNodes(graph).find(
      (t) => t.id !== id && t.name.toLowerCase() === name.toLowerCase(),
    )
    if (duplicate) throw new Error(`Task "${name}" already exists (${duplicate.id})`)
    updates.name = name
  }
  if (input.description !== undefined) updates.description = input.description

  const metadata: Record<string, unknown> = { ...(task.metadata as Record<string, unknown>) }
  if (input.metadata) Object.assign(metadata, input.metadata)
  if (input.goal !== undefined) metadata.goal = input.goal
  if (input.files !== undefined) metadata.files = input.files
  if (input.acceptance !== undefined) metadata.acceptance = input.acceptance
  if (input.priority !== undefined) metadata.priority = input.priority

  let status = task.status
  if (input.column && isTaskColumn(input.column)) status = columnToStatus(input.column)
  if (input.status) status = input.status
  if (input.column || input.status) {
    updates.status = status
    metadata.board_column = statusToColumn(status)
  } else if (metadata.board_column === undefined) {
    metadata.board_column = statusToColumn(status)
  }

  if (input.markPending) {
    metadata.integration_status = "pending"
    metadata.integration_requested_at = new Date().toISOString()
  }
  if (input.priority !== undefined) {
    metadata.priority = input.priority
  }

  updates.metadata = metadata as AnyNode["metadata"]
  return updateNode(graph, id, updates) as TaskNode
}

export function removeTask(graph: KnowledgeGraph, id: string): void {
  const task = getTask(graph, id)
  if (!task) throw new Error(`Task ${id} not found`)
  removeNode(graph, id)
}

export function markTaskIntegrated(graph: KnowledgeGraph, id: string): TaskNode {
  const task = getTask(graph, id)
  if (!task) throw new Error(`Task ${id} not found`)
  const metadata: Record<string, unknown> = {
    ...(task.metadata as Record<string, unknown>),
    integration_status: "integrated",
    integrated_at: new Date().toISOString(),
  }
  return updateNode(graph, id, { metadata } as Partial<AnyNode>) as TaskNode
}

export function getPendingIntegrationTasks(graph: KnowledgeGraph): TaskNode[] {
  return getTaskNodes(graph).filter((task) => taskIntegrationStatus(task) === "pending")
}

/**
 * Deterministic integration plan handed to the agent (via the system prompt or
 * the `sdd.integrate_tasks` tool). It never mutates the graph itself.
 */
export function buildIntegrationBrief(graph: KnowledgeGraph): string {
  const pending = getPendingIntegrationTasks(graph)
  if (pending.length === 0) {
    return "## SDD Tasks — nenhuma task pendente de integração."
  }

  const lines = [`## SDD Tasks — ${pending.length} task(s) pendentes de integração`, ""]
  for (const task of pending) {
    const meta = task.metadata as Record<string, unknown>
    lines.push(`### ${task.id}: ${task.name}`)
    if (task.description) lines.push(`- Descrição: ${task.description}`)
    if (meta.goal) lines.push(`- Objetivo: ${String(meta.goal)}`)
    if (Array.isArray(meta.files) && meta.files.length > 0) {
      lines.push(`- Arquivos previstos: ${meta.files.join(", ")}`)
    }
    if (Array.isArray(meta.acceptance) && meta.acceptance.length > 0) {
      lines.push(`- Critérios de aceite: ${meta.acceptance.join("; ")}`)
    }
    lines.push("")
  }

  lines.push(
    "**Como integrar:** vincule a task ao `feature`/`requirement` correspondente com `sdd.add_relationship` " +
      "(tipo `implements`), crie `test` quando houver cobertura (`tested_by`) e registre `decision`/`file` " +
      "quando fizer sentido. Não altere arquivos de código-fonte nesta etapa — ela é só de especificação. " +
      'Ao terminar, chame `sdd.integrate_tasks` com `action="mark_integrated"` e o `task_id` — a task integrada ' +
      'abre o Change SDD automaticamente e é ele que autoriza a escrita do código.',
  )
  return lines.join("\n")
}

/** Short, deterministic prompt used to wake the agent when a card is saved. */
export function buildTaskIntegrationPrompt(taskId: string, name: string): string {
  return [
    "## SDD: integração de task manual",
    "",
    `O dashboard criou/alterou a task \`${taskId}\` ("${name}").`,
    "",
    "Integre-a ao Knowledge Graph agora:",
    "1. Chame a tool `sdd.integrate_tasks` com `action=\"list\"` para ver o plano de integração.",
    "2. Crie as relações e os nós de apoio necessários (`implements` para feature/requirement, `tested_by`, `depends_on`/`blocked_by`, `decision`, `file`).",
    `3. Ao terminar, chame \`sdd.integrate_tasks\` com \`action="mark_integrated"\` e \`task_id="${taskId}"\`.`,
    "   Isso abre o Change SDD da task (a autorização de escrita do código).",
    `4. Se o Change ficar em rascunho, aprove com \`sdd.integrate_tasks\` (\`action="approve_change"\`, \`task_id="${taskId}"\`) e então implemente o código correspondente.`,
    "",
    "A etapa de integração altera apenas o grafo SDD — só escreva código depois do Change aprovado.",
  ].join("\n")
}
