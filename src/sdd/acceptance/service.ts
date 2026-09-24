import { createHash } from "crypto"
import type {
  AcceptanceCriterionNode,
  AcceptanceStatus,
  AnyNode,
  KnowledgeGraph,
} from "../domain/types.js"
import { addNode, addRelationship, getIncoming, getNode, updateNode } from "../graph/engine.js"

export interface AcceptanceEvidence {
  type?: string
  source?: string
  id?: string
  summary?: string
}

export interface AcceptanceAuditEvent {
  action: "accept" | "reject" | "waive" | "reopen" | "invalidate" | "create" | "update_text"
  criterion_id: string
  actor: string
  timestamp: string
  previous_status?: AcceptanceStatus
  status: AcceptanceStatus
  previous_hash?: string
  content_hash: string
  observation?: string
}

export interface AcceptanceAuditSink {
  record(event: AcceptanceAuditEvent): void
}

export interface AcceptanceMutationInput {
  actor: string
  observation?: string
  evidence?: AcceptanceEvidence[]
  expected_version?: number
  expected_hash?: string
}

export interface AcceptAllResult {
  requirement_id: string
  selected: number
  accepted: string[]
  skipped: string[]
  failed: Array<{ criterion_id: string; reason: string }>
  timestamp: string
  actor: string
  audit: AcceptanceAuditEvent[]
}

export interface AcceptanceSummary {
  total: number
  pending: number
  accepted: number
  rejected: number
  waived: number
  all_accepted: boolean
}

export interface ChangeAcceptanceCheck {
  allowed: boolean
  requirements: string[]
  pending: string[]
  rejected: string[]
  waived: string[]
  reason: string
}

function criterionMetadata(node: AcceptanceCriterionNode): AcceptanceCriterionNode["metadata"] {
  return node.metadata
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ")
}

export function acceptanceContentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex")
}

function criterionId(graph: KnowledgeGraph, requirementId: string, text: string): string {
  const digest = acceptanceContentHash(text).slice(0, 16).toUpperCase()
  return `${graph.project_id}-AC-${requirementId.slice(-24)}-${digest}`
}

function now(): string {
  return new Date().toISOString()
}

function requirementIdsForCriterion(graph: KnowledgeGraph, criterionId: string): string[] {
  return getIncoming(graph, criterionId)
    .filter((rel) => rel.type === "has_acceptance_criterion")
    .map((rel) => rel.from)
}

export function getAcceptanceCriteria(
  graph: KnowledgeGraph,
  requirementId: string,
  includeLegacy = true,
): AcceptanceCriterionNode[] {
  const criteria = graph.relationships
    .filter((rel) => rel.from === requirementId && rel.type === "has_acceptance_criterion")
    .map((rel) => getNode(graph, rel.to))
    .filter((node): node is AcceptanceCriterionNode => node?.type === "acceptance_criterion")

  if (criteria.length > 0 || !includeLegacy) return criteria

  const requirement = getNode(graph, requirementId)
  if (!requirement || requirement.type !== "requirement") return []
  const legacy = (requirement.metadata as Record<string, unknown>).acceptance_criteria
  if (!Array.isArray(legacy)) return []

  return legacy
    .filter((text): text is string => typeof text === "string" && text.trim().length > 0)
    .map((text, index) => ({
      id: `${graph.project_id}-LEGACY-AC-${requirementId.slice(-20)}-${index + 1}`,
      type: "acceptance_criterion",
      name: text.slice(0, 120),
      description: text,
      status: "PENDING",
      version: 1,
      metadata: {
        text,
        criterion_version: 1,
        content_hash: acceptanceContentHash(text),
        legacy_source: "requirement.metadata.acceptance_criteria",
      },
      created_at: requirement.created_at,
      updated_at: requirement.updated_at,
    } as AcceptanceCriterionNode))
}

export function createAcceptanceCriterion(
  graph: KnowledgeGraph,
  requirementId: string,
  text: string,
  legacySource?: string,
): AcceptanceCriterionNode {
  const requirement = getNode(graph, requirementId)
  if (!requirement || requirement.type !== "requirement") {
    throw new Error(`Requirement ${requirementId} not found`)
  }

  const normalized = normalizeText(text)
  if (!normalized) throw new Error("Acceptance criterion text cannot be empty")
  const hash = acceptanceContentHash(normalized)
  const existing = getAcceptanceCriteria(graph, requirementId, false).find(
    (criterion) => criterion.metadata.content_hash === hash,
  )
  if (existing) return existing

  const id = criterionId(graph, requirementId, normalized)
  const timestamp = now()
  const node: AcceptanceCriterionNode = {
    id,
    type: "acceptance_criterion",
    name: normalized.slice(0, 120),
    description: normalized,
    status: "PENDING",
    version: 1,
    metadata: {
      text: normalized,
      criterion_version: 1,
      content_hash: hash,
      ...(legacySource ? { legacy_source: legacySource } : {}),
    },
    created_at: timestamp,
    updated_at: timestamp,
  }
  addNode(graph, node)
  addRelationship(graph, requirementId, id, "has_acceptance_criterion", { source: "acceptance_service" })
  return node
}

export function updateAcceptanceCriterionText(
  graph: KnowledgeGraph,
  criterionId: string,
  text: string,
  input: Pick<AcceptanceMutationInput, "actor" | "observation">,
): AcceptanceCriterionNode {
  const criterion = getNode(graph, criterionId)
  if (!criterion || criterion.type !== "acceptance_criterion") {
    throw new Error(`Acceptance criterion ${criterionId} not found`)
  }
  const current = criterion as AcceptanceCriterionNode
  const normalized = normalizeText(text)
  if (!normalized) throw new Error("Acceptance criterion text cannot be empty")
  const hash = acceptanceContentHash(normalized)
  if (hash === current.metadata.content_hash) return current

  const metadata = {
    ...criterionMetadata(current),
    text: normalized,
    criterion_version: current.metadata.criterion_version + 1,
    content_hash: hash,
    previous_status: current.status,
    previous_hash: current.metadata.content_hash,
    ...(input.observation ? { observation: input.observation } : {}),
    accepted_by: undefined,
    accepted_at: undefined,
    evidence: undefined,
  }
  return updateNode(graph, criterionId, {
    name: normalized.slice(0, 120),
    description: normalized,
    status: "PENDING",
    metadata,
    created_by: input.actor,
  }) as AcceptanceCriterionNode
}

export class AcceptanceService {
  constructor(
    private readonly graph: KnowledgeGraph,
    private readonly includeLegacyFallback = true,
    private readonly auditSink?: AcceptanceAuditSink,
  ) {}

  private emit(event: AcceptanceAuditEvent): void {
    this.auditSink?.record(event)
  }

  list(requirementId?: string, includeLegacy = true): AcceptanceCriterionNode[] {
    if (requirementId) return getAcceptanceCriteria(this.graph, requirementId, includeLegacy && this.includeLegacyFallback)
    return this.graph.nodes.filter((node): node is AcceptanceCriterionNode => node.type === "acceptance_criterion")
  }

  summary(requirementId: string, includeLegacy = true, allowWaived = true): AcceptanceSummary {
    const criteria = this.list(requirementId, includeLegacy)
    const counts = { total: criteria.length, pending: 0, accepted: 0, rejected: 0, waived: 0 }
    for (const criterion of criteria) {
      if (criterion.status === "PENDING") counts.pending++
      else if (criterion.status === "ACCEPTED") counts.accepted++
      else if (criterion.status === "REJECTED") counts.rejected++
      else if (criterion.status === "WAIVED") counts.waived++
    }
    return {
      ...counts,
      all_accepted: counts.total > 0 && counts.pending === 0 && counts.rejected === 0 && (allowWaived || counts.waived === 0),
    }
  }

  create(requirementId: string, text: string, legacySource?: string, actor = "system"): AcceptanceCriterionNode {
    const before = getAcceptanceCriteria(this.graph, requirementId, false)
    const criterion = createAcceptanceCriterion(this.graph, requirementId, text, legacySource)
    if (!before.some((item) => item.id === criterion.id)) {
      const timestamp = now()
      this.emit({
        action: "create",
        criterion_id: criterion.id,
        actor,
        timestamp,
        status: criterion.status,
        content_hash: criterion.metadata.content_hash,
      })
    }
    return criterion
  }

  updateText(
    criterionId: string,
    text: string,
    input: Pick<AcceptanceMutationInput, "actor" | "observation">,
  ): { criterion: AcceptanceCriterionNode; audit?: AcceptanceAuditEvent } {
    const current = getNode(this.graph, criterionId)
    if (!current || current.type !== "acceptance_criterion") {
      throw new Error(`Acceptance criterion ${criterionId} not found`)
    }
    const previous = current as AcceptanceCriterionNode
    const criterion = updateAcceptanceCriterionText(this.graph, criterionId, text, input)
    if (criterion.version === previous.version) return { criterion }
    const audit: AcceptanceAuditEvent = {
      action: "update_text",
      criterion_id: criterionId,
      actor: input.actor,
      timestamp: now(),
      previous_status: previous.status,
      status: criterion.status,
      previous_hash: previous.metadata.content_hash,
      content_hash: criterion.metadata.content_hash,
      observation: input.observation,
    }
    this.emit(audit)
    return { criterion, audit }
  }

  transition(
    criterionId: string,
    status: AcceptanceStatus,
    input: AcceptanceMutationInput,
  ): { criterion: AcceptanceCriterionNode; audit: AcceptanceAuditEvent } {
    const node = getNode(this.graph, criterionId)
    if (!node || node.type !== "acceptance_criterion") throw new Error(`Acceptance criterion ${criterionId} not found`)
    const criterion = node as AcceptanceCriterionNode
    if (input.expected_version !== undefined && criterion.version !== input.expected_version) {
      throw new Error(`Acceptance criterion ${criterionId} version conflict: expected ${input.expected_version}, current ${criterion.version}`)
    }
    if (input.expected_hash !== undefined && criterion.metadata.content_hash !== input.expected_hash) {
      throw new Error(`Acceptance criterion ${criterionId} content hash conflict`)
    }
    if (status === "WAIVED" && !input.observation?.trim()) {
      throw new Error("A waiver requires an observation")
    }
    const timestamp = now()
    const metadata = {
      ...criterion.metadata,
      previous_status: criterion.status,
      ...(input.observation !== undefined ? { observation: input.observation } : {}),
      ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
      ...(status === "ACCEPTED" || status === "WAIVED"
        ? { accepted_by: input.actor, accepted_at: timestamp }
        : { accepted_by: undefined, accepted_at: undefined }),
    }
    const updated = updateNode(this.graph, criterionId, {
      status,
      metadata,
      created_by: input.actor,
    }) as AcceptanceCriterionNode
    const audit: AcceptanceAuditEvent = {
      action: status === "ACCEPTED" ? "accept" : status === "REJECTED" ? "reject" : status === "WAIVED" ? "waive" : "reopen",
      criterion_id: criterionId,
      actor: input.actor,
      timestamp,
      previous_status: criterion.status,
      status,
      content_hash: criterion.metadata.content_hash,
      observation: input.observation,
    }
    this.emit(audit)
    return {
      criterion: updated,
      audit,
    }
  }

  accept(criterionId: string, input: AcceptanceMutationInput) {
    return this.transition(criterionId, "ACCEPTED", input)
  }

  reject(criterionId: string, input: AcceptanceMutationInput) {
    return this.transition(criterionId, "REJECTED", input)
  }

  waive(criterionId: string, input: AcceptanceMutationInput) {
    return this.transition(criterionId, "WAIVED", input)
  }

  reopen(criterionId: string, input: AcceptanceMutationInput) {
    return this.transition(criterionId, "PENDING", input)
  }

  acceptAll(requirementId: string, input: AcceptanceMutationInput): AcceptAllResult {
    // Prepare the complete operation on an isolated graph. The caller only
    // receives the new state after every criterion and version check passes.
    const working = structuredClone(this.graph) as KnowledgeGraph
    const worker = new AcceptanceService(working, false)
    let criteria = worker.list(requirementId, false)
    // Legacy projects may still expose virtual criteria. Materialize them on
    // the first mutating operation so accept-all always updates persisted
    // records and remains a single auditable transaction for YAML/SQLite.
    if (criteria.length === 0) {
      const legacy = this.list(requirementId, true)
      for (const criterion of legacy) createAcceptanceCriterion(working, requirementId, criterion.metadata.text, criterion.metadata.legacy_source)
      criteria = worker.list(requirementId, false)
    }
    const result: AcceptAllResult = {
      requirement_id: requirementId,
      selected: criteria.filter((criterion) => criterion.status === "PENDING").length,
      accepted: [],
      skipped: [],
      failed: [],
      timestamp: now(),
      actor: input.actor,
      audit: [],
    }
    // Preflight every pending criterion before mutating any of them. This is
    // what makes the operation atomic for both YAML snapshots and SQLite
    // transactions when the caller persists the graph once.
    for (const criterion of criteria) {
      if (criterion.status !== "PENDING") continue
      if (input.expected_version !== undefined && criterion.version !== input.expected_version) {
        result.failed.push({ criterion_id: criterion.id, reason: `version conflict: expected ${input.expected_version}, current ${criterion.version}` })
      }
      if (input.expected_hash !== undefined && criterion.metadata.content_hash !== input.expected_hash) {
        result.failed.push({ criterion_id: criterion.id, reason: "content hash conflict" })
      }
    }
    if (result.failed.length > 0) return result
    for (const criterion of criteria) {
      if (criterion.status !== "PENDING") {
        result.skipped.push(criterion.id)
        continue
      }
      try {
        const transitioned = worker.accept(criterion.id, input)
        result.accepted.push(criterion.id)
        result.audit.push(transitioned.audit)
      } catch (error) {
        result.failed.push({ criterion_id: criterion.id, reason: error instanceof Error ? error.message : String(error) })
        break
      }
    }
    if (result.failed.length > 0) return result
    this.graph.nodes = working.nodes
    this.graph.relationships = working.relationships
    this.graph.metadata = working.metadata
    for (const event of result.audit) this.emit(event)
    return result
  }

  invalidateForRequirement(requirementId: string, actor: string, observation?: string): AcceptanceAuditEvent[] {
    const events: AcceptanceAuditEvent[] = []
    for (const criterion of this.list(requirementId, false)) {
      if (criterion.status === "PENDING") continue
      const transitioned = this.reopen(criterion.id, { actor, observation })
      events.push({ ...transitioned.audit, action: "invalidate" })
    }
    return events
  }

  requirementForCriterion(criterionId: string): AnyNode | undefined {
    return requirementIdsForCriterion(this.graph, criterionId)
      .map((id) => getNode(this.graph, id))
      .find((node) => node?.type === "requirement")
  }
}

export function checkChangeAcceptance(graph: KnowledgeGraph, changeId: string, options: { allowWaived?: boolean; legacyFallback?: boolean } = {}): ChangeAcceptanceCheck {
  const change = getNode(graph, changeId)
  if (!change || change.type !== "change") {
    return { allowed: false, requirements: [], pending: [], rejected: [], waived: [], reason: `Change ${changeId} not found` }
  }
  const requirementIds = new Set<string>()
  for (const affectedId of change.metadata.affected_nodes || []) {
    const affected = getNode(graph, affectedId)
    if (!affected) continue
    if (affected.type === "requirement") requirementIds.add(affected.id)
    if (affected.type === "acceptance_criterion") {
      for (const requirementId of requirementIdsForCriterion(graph, affected.id)) requirementIds.add(requirementId)
    }
    for (const relationship of graph.relationships) {
      if (relationship.type === "implements" && relationship.from === affected.id && getNode(graph, relationship.to)?.type === "requirement") requirementIds.add(relationship.to)
      if (relationship.type === "specifies" && relationship.to === affected.id && getNode(graph, relationship.from)?.type === "requirement") requirementIds.add(relationship.from)
      if (relationship.type === "satisfied_by" && relationship.from === affected.id && getNode(graph, relationship.to)?.type === "requirement") requirementIds.add(relationship.to)
    }
  }
  const pending: string[] = []
  const rejected: string[] = []
  const waived: string[] = []
  for (const requirementId of requirementIds) {
    for (const criterion of getAcceptanceCriteria(graph, requirementId, options.legacyFallback !== false)) {
      if (criterion.status === "PENDING") pending.push(criterion.id)
      if (criterion.status === "REJECTED") rejected.push(criterion.id)
      if (criterion.status === "WAIVED") waived.push(criterion.id)
    }
  }
  const allowed = pending.length === 0 && rejected.length === 0 && (options.allowWaived !== false || waived.length === 0)
  return {
    allowed,
    requirements: [...requirementIds],
    pending,
    rejected,
    waived,
    reason: allowed ? "" : `Acceptance incomplete: ${pending.length} pending, ${rejected.length} rejected and ${options.allowWaived === false ? waived.length : 0} non-waived criterion(s).`,
  }
}

export interface LegacyAcceptanceMigrationOptions {
  /** Remove legacy copies only after every value was materialized successfully. */
  removeLegacy?: boolean
}

export function materializeLegacyAcceptanceCriteria(
  graph: KnowledgeGraph,
  options: LegacyAcceptanceMigrationOptions = {},
): { created: number; linked: number; unresolved: string[]; removed: number } {
  let created = 0
  let linked = 0
  const unresolved: string[] = []
  let removed = 0
  for (const requirement of graph.nodes.filter((node) => node.type === "requirement")) {
    const values = (requirement.metadata as Record<string, unknown>).acceptance_criteria
    if (!Array.isArray(values)) continue
    let materialized = true
    for (const value of values.filter((item): item is string => typeof item === "string" && item.trim().length > 0)) {
      try {
        const before = getAcceptanceCriteria(graph, requirement.id, false).length
        const criterion = createAcceptanceCriterion(graph, requirement.id, value, "requirement.metadata.acceptance_criteria")
        if (getAcceptanceCriteria(graph, requirement.id, false).length > before) created++
        if (criterion) linked++
      } catch {
        materialized = false
      }
    }
    if (options.removeLegacy && materialized) {
      delete (requirement.metadata as Record<string, unknown>).acceptance_criteria
      ;(requirement.metadata as Record<string, unknown>).acceptance_migrated_at = now()
      requirement.updated_at = now()
      removed++
    }
  }
  for (const task of graph.nodes.filter((node) => node.type === "task")) {
    const values = (task.metadata as Record<string, unknown>).acceptance
    if (!Array.isArray(values) || values.length === 0) continue
    const requirementRel = graph.relationships.find((rel) =>
      rel.from === task.id && rel.type === "implements" && getNode(graph, rel.to)?.type === "requirement",
    )
    if (!requirementRel) unresolved.push(task.id)
    else {
      for (const value of values.filter((item): item is string => typeof item === "string" && item.trim().length > 0)) {
        createAcceptanceCriterion(graph, requirementRel.to, value, `task:${task.id}`)
      }
      if (options.removeLegacy) {
        const metadata = task.metadata as Record<string, unknown>
        delete metadata.acceptance
        delete metadata.legacy_acceptance
        metadata.acceptance_migrated_at = now()
        task.updated_at = now()
        removed++
      }
    }
  }
  return { created, linked, unresolved, removed }
}
