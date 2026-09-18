/**
 * Task → Change bridge.
 *
 * A Kanban task is only a work item: it declares intent, not the authorization
 * to touch code. In this plugin the write hook only accepts Write/Edit on files
 * covered by an APPROVED `change` node, so an integrated task still has no way
 * to produce code.
 *
 * This module closes that gap deterministically, reusing the existing pieces:
 *   - `createChange` (src/sdd/changes/manager.ts) builds the ChangeNode with
 *     impact analysis, approval level and the `affected_files` scope;
 *   - `preflightChangeScope` tells whether the scope is complete enough for the
 *     write hook (no `affected_files` ⇒ every Write/Edit is refused);
 *   - `approveChange` opens the gate for AUTO-level changes.
 *
 * Nothing here generates code. It opens the Change and hands the agent a prompt
 * that says exactly which files are covered — the implementation itself stays in
 * the normal SDD loop (enforce → write → test → complete_change).
 */

import type {
  AnyNode,
  ApprovalLevel,
  ChangeNode,
  KnowledgeGraph,
  NodeStatus,
  TaskNode,
} from "../domain/types.js"
import { approveChange, createChange, preflightChangeScope } from "../changes/manager.js"
import { addRelationship, getNode, updateNode } from "../graph/engine.js"
import { getTask, statusToColumn } from "./board.js"

/** Spec node types a task can point at; they become the Change impact scope. */
/** The project root is always linked to a task, so it is not an impact. */
const SPEC_NODE_TYPES = new Set([
  "domain",
  "feature",
  "requirement",
  "entity",
  "value_object",
  "architecture_component",
  "api",
  "endpoint",
  "module",
  "business_rule",
  "flow",
  "use_case",
  "database",
  "table",
])

const TEST_FILE_PATTERN = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z0-9]+$/i

export interface OpenChangeInput {
  /** Overrides the file scope; defaults to `task.metadata.files`. */
  files?: string[]
  /**
   * Approve AUTO-level changes automatically (default: true). REVIEW/APPROVAL
   * changes are never approved unless `approve` is explicitly set.
   */
  autoApprove?: boolean
  /** Explicit human approval — required for REVIEW/APPROVAL level changes. */
  approve?: boolean
  /** Declare that no specified behaviour changes (skips requirement evidence). */
  noRequirementImpact?: boolean
}

export interface OpenChangeResult {
  change: ChangeNode
  /** false when the task already had a Change (idempotent re-run). */
  created: boolean
  /** true when the Change is APPROVED and the write hook accepts its files. */
  approved: boolean
  approval_level: ApprovalLevel
  affected_files: string[]
  affected_nodes: string[]
  /** Reasons the Change cannot be used yet (approval or incomplete scope). */
  blockers: string[]
  warnings: string[]
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.length > 0)
}

/** The Change already attached to a task, if any. */
export function findTaskChange(graph: KnowledgeGraph, taskId: string): ChangeNode | undefined {
  const task = getTask(graph, taskId)
  if (!task) return undefined

  const declared = (task.metadata as Record<string, unknown>).change_id
  if (typeof declared === "string" && declared.length > 0) {
    const node = getNode(graph, declared)
    if (node?.type === "change") return node as ChangeNode
  }

  // Fallback: the bridge links change → task with `affects`, so scan the edges
  // in case the metadata was written by an older version.
  for (const rel of graph.relationships) {
    if (rel.from !== taskId && rel.to !== taskId) continue
    const otherId = rel.from === taskId ? rel.to : rel.from
    const other = getNode(graph, otherId)
    if (other?.type === "change") return other as ChangeNode
  }
  return undefined
}

/** Spec nodes the task is connected to (they define the Change impact scope). */
function specTargets(graph: KnowledgeGraph, taskId: string): string[] {
  const ids = new Set<string>()
  for (const rel of graph.relationships) {
    if (rel.from !== taskId && rel.to !== taskId) continue
    const otherId = rel.from === taskId ? rel.to : rel.from
    const other = getNode(graph, otherId)
    if (other && SPEC_NODE_TYPES.has(other.type)) ids.add(other.id)
  }
  return [...ids]
}

function toResult(
  graph: KnowledgeGraph,
  change: ChangeNode,
  created: boolean,
  extraWarnings: string[] = [],
): OpenChangeResult {
  const current = (getNode(graph, change.id) as ChangeNode | undefined) ?? change
  const preflight = preflightChangeScope(graph, current.id)
  const approved = current.status === "APPROVED"

  const blockers: string[] = []
  if (!approved) {
    blockers.push(...preflight.blockers)
    if (current.metadata.approval_level === "BLOCKED") {
      blockers.push(`Change ${current.id} is blocked by the approval classifier and cannot be approved automatically.`)
    } else if (preflight.blockers.length === 0) {
      blockers.push(
        `Change ${current.id} requires explicit approval (level: ${current.metadata.approval_level}). ` +
          'Approve it with `sdd.integrate_tasks` (action="approve_change") or the "Aprovar" button in the Kanban.',
      )
    }
  }

  return {
    change: current,
    created,
    approved,
    approval_level: current.metadata.approval_level,
    affected_files: [...current.metadata.affected_files],
    affected_nodes: [...current.metadata.affected_nodes],
    blockers,
    warnings: [...preflight.warnings, ...extraWarnings],
  }
}

/**
 * Open (or return) the SDD Change for a task.
 *
 * Idempotent: calling it twice returns the same Change instead of stacking
 * duplicates. With `approve` (or an AUTO-level change) the Change becomes
 * APPROVED, which is what the write hook requires, and the task moves to
 * `in_progress` because the work has effectively started.
 */
export function openChangeForTask(
  graph: KnowledgeGraph,
  taskId: string,
  input: OpenChangeInput = {},
): OpenChangeResult {
  const task = getTask(graph, taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const existing = findTaskChange(graph, taskId)
  if (existing) {
    if (input.approve && existing.status !== "APPROVED") {
      const preflight = preflightChangeScope(graph, existing.id)
      if (preflight.blockers.length === 0 && existing.metadata.approval_level !== "BLOCKED") {
        approveChange(graph, existing.id)
        syncTaskWithChange(graph, task, existing.id)
      }
    }
    return toResult(graph, existing, false)
  }

  const metadata = task.metadata as Record<string, unknown>
  const files = input.files ?? readStringArray(metadata.files)
  const affectedNodes = specTargets(graph, taskId)
  const affectedTests = files.filter((file) => TEST_FILE_PATTERN.test(file))
  const hasRequirement = affectedNodes.some((id) => getNode(graph, id)?.type === "requirement")
  const goal = typeof metadata.goal === "string" ? metadata.goal.trim() : ""

  const change = createChange(graph, {
    title: task.name,
    reason:
      task.description?.trim() ||
      goal ||
      `Task ${task.id} created from the Kanban board (origin: ${String(metadata.origin ?? "dashboard")}).`,
    affected_node_ids: affectedNodes,
    new_nodes: [],
    modified_nodes: [],
    removed_node_ids: [],
    affected_files: files,
    affected_tests: affectedTests,
    implementation_tasks: [task.id],
    no_requirement_impact: input.noRequirementImpact ?? affectedNodes.length === 0,
  })

  // Link both ways: the Change affects the spec nodes, and it is attached to the
  // task so the board can show the Change badge and the graph stays connected.
  for (const nodeId of affectedNodes) {
    if (nodeId === change.id) continue
    try {
      addRelationship(graph, change.id, nodeId, "affects")
    } catch {
      // Relationship already exists or would create a cycle — the id is still
      // declared in `affected_nodes`.
    }
  }
  try {
    addRelationship(graph, change.id, task.id, "affects")
  } catch {
    // Same as above: `task.metadata.change_id` remains the source of truth.
  }

  const preflight = preflightChangeScope(graph, change.id)
  const approvable = change.metadata.approval_level !== "BLOCKED" && preflight.blockers.length === 0
  const autoApprove = (input.autoApprove ?? true) && change.metadata.approval_level === "AUTO"
  if (approvable && (autoApprove || input.approve)) {
    approveChange(graph, change.id)
  }

  // Spec nodes without a requirement leave the Change without evaluable
  // functional evidence — warn now instead of at completion time.
  const extraWarnings: string[] = []
  if (!hasRequirement && affectedNodes.length > 0) {
    extraWarnings.push(
      "Nenhum `requirement` está vinculado à task, então a evidência funcional do Change não é avaliável. " +
        "Vincule a task a um requisito (`implements`) ou marque `no_requirement_impact` ao abrir o Change.",
    )
  }

  syncTaskWithChange(graph, task, change.id)
  return toResult(graph, change, true, extraWarnings)
}

/** Keep `task.metadata.change_id` / `change_status` and the column in sync. */
function syncTaskWithChange(graph: KnowledgeGraph, task: TaskNode, changeId: string): void {
  const change = getNode(graph, changeId) as ChangeNode | undefined
  const metadata: Record<string, unknown> = {
    ...(task.metadata as Record<string, unknown>),
    change_id: changeId,
    change_status: change?.status ?? "DRAFT",
  }

  const updates: Partial<AnyNode> = { metadata }
  // An approved Change means the code work started — reflect that on the board.
  if (change?.status === "APPROVED") {
    const column = statusToColumn(task.status)
    if (column === "backlog" || column === "ready") updates.status = "in_progress" as NodeStatus
  }
  updateNode(graph, task.id, updates)
}

/**
 * Prompt that asks the agent to implement the approved Change (i.e. to actually
 * write the code the task described). Deterministic text, no LLM call here.
 */
export function buildChangeImplementationPrompt(change: ChangeNode, task: TaskNode): string {
  const files = change.metadata.affected_files
  const lines = [
    "## SDD: implementar o Change aberto pela task",
    "",
    `A task \`${task.id}\` ("${task.name}") abriu o Change \`${change.id}\` — status **${change.status}**, aprovação **${change.metadata.approval_level}**.`,
    "",
    "Implemente o código correspondente seguindo o fluxo SDD:",
    `1. O Change \`${change.id}\` já é a autorização de escrita — não crie outro Change.`,
    "2. Altere apenas os arquivos cobertos pelo escopo declarado.",
    "3. Rode os testes relevantes (`sdd.verify_implementation` quando aplicável).",
    `4. Finalize com \`sdd.complete_change\` (\`change_id: "${change.id}"\`).`,
    "",
    files.length > 0
      ? `Arquivos cobertos: ${files.join(", ")}`
      : "⚠️ O Change não declara `affected_files`, então o hook de escrita vai recusar Write/Edit. " +
        "Atualize o escopo do Change (`sdd.update_node` com `metadata.affected_files`) antes de editar qualquer arquivo.",
    "",
    "Não altere arquivos fora do escopo declarado.",
  ]
  return lines.join("\n")
}

/** Human-readable summary used by the tools and the `/sdd tasks change` command. */
export function formatOpenChangeResult(result: OpenChangeResult): string {
  const lines = [
    `## SDD Change ${result.change.id}`,
    "",
    `**Task:** ${result.change.metadata.implementation_tasks.join(", ") || "—"}`,
    `**Título:** ${result.change.metadata.title}`,
    `**Status:** ${result.change.status}`,
    `**Aprovação:** ${result.approval_level}`,
    `**Arquivos:** ${result.affected_files.length > 0 ? result.affected_files.join(", ") : "— (nenhum declarado)"}`,
    `**Nós afetados:** ${result.affected_nodes.length > 0 ? result.affected_nodes.join(", ") : "—"}`,
    result.created ? "**Criado agora:** sim" : "**Criado agora:** não (Change já existia)",
    "",
  ]

  if (result.approved) {
    lines.push("✅ Change aprovado — o hook de escrita libera os arquivos declarados. Próximo passo: implementar o código.")
  } else {
    lines.push("⏳ Change em rascunho — aprovação necessária antes de escrever código.")
  }

  if (result.blockers.length > 0) {
    lines.push("", "### Blockers")
    for (const blocker of result.blockers) lines.push(`- ${blocker}`)
  }
  if (result.warnings.length > 0) {
    lines.push("", "### Warnings")
    for (const warning of result.warnings) lines.push(`- ${warning}`)
  }
  return lines.join("\n")
}

/** Tasks that already produced a Change but still need approval to unfold. */
export function getTasksAwaitingChangeApproval(
  graph: KnowledgeGraph,
): Array<{ task: TaskNode; change: ChangeNode }> {
  const pending: Array<{ task: TaskNode; change: ChangeNode }> = []
  for (const node of graph.nodes) {
    if (node.type !== "task") continue
    const declared = (node.metadata as Record<string, unknown>).change_id
    if (typeof declared !== "string") continue
    const change = getNode(graph, declared)
    if (!change || change.type !== "change") continue
    if (change.status === "DRAFT" || change.status === "PROPOSED") {
      pending.push({ task: node as TaskNode, change: change as ChangeNode })
    }
  }
  return pending
}
