import type { AnyNode, GuidanceNode, KnowledgeGraph } from "../domain/types.js"
import { addNode, addRelationship, getNode, updateNode } from "../graph/engine.js"
import { analyzeNodeImpact, type NodeImpactResult } from "../impact/service.js"
import { updateAcceptanceCriterionText } from "../acceptance/service.js"

export interface GuidanceInput {
  instruction: string
  requested_by: string
  priority?: GuidanceNode["metadata"]["priority"]
  scope?: string
}

interface PropagatedUpdate {
  node_id: string
  patch: Record<string, unknown>
  expected_version?: number
}

function now(): string {
  return new Date().toISOString()
}

function guidanceId(graph: KnowledgeGraph): string {
  const count = graph.nodes.filter((node) => node.type === "guidance").length + 1
  return `${graph.project_id}-GUIDE-${String(count).padStart(4, "0")}`
}

export function createGuidance(graph: KnowledgeGraph, targetNodeId: string, input: GuidanceInput): GuidanceNode {
  const target = getNode(graph, targetNodeId)
  if (!target) throw new Error(`Target node ${targetNodeId} not found`)
  if (!input.instruction.trim()) throw new Error("Guidance instruction cannot be empty")
  const timestamp = now()
  const guidance: GuidanceNode = {
    id: guidanceId(graph),
    type: "guidance",
    name: `Guidance for ${target.name}`,
    description: input.instruction,
    status: "DRAFT",
    version: 1,
    metadata: {
      instruction: input.instruction.trim(),
      target_node_id: targetNodeId,
      requested_by: input.requested_by,
      priority: input.priority || "medium",
      scope: input.scope,
      status: "OPEN",
    },
    created_at: timestamp,
    updated_at: timestamp,
    created_by: input.requested_by,
  }
  addNode(graph, guidance)
  addRelationship(graph, guidance.id, targetNodeId, "guides", { source: "human_guidance" })
  try { addRelationship(graph, graph.project_id, guidance.id, "contains", { source: "human_guidance" }) } catch {}
  return guidance
}

export function analyzeGuidance(graph: KnowledgeGraph, guidanceId: string, maxDepth = 5): { guidance: GuidanceNode; impact: NodeImpactResult } {
  const node = getNode(graph, guidanceId)
  if (!node || node.type !== "guidance") throw new Error(`Guidance ${guidanceId} not found`)
  const guidance = node as GuidanceNode
  const impact = analyzeNodeImpact(graph, guidance.metadata.target_node_id, maxDepth)
  updateNode(graph, guidanceId, {
    metadata: {
      ...guidance.metadata,
      status: "ANALYZED",
      impact_node_ids: [...new Set([
        ...impact.direct.map((item) => item.node.id),
        ...impact.indirect.map((item) => item.node.id),
        ...impact.potential.map((item) => item.node.id),
      ])],
    },
  })
  return { guidance: getNode(graph, guidanceId) as GuidanceNode, impact }
}

export function proposeGuidancePatch(
  graph: KnowledgeGraph,
  guidanceId: string,
  proposal: Record<string, unknown>,
): GuidanceNode {
  const node = getNode(graph, guidanceId)
  if (!node || node.type !== "guidance") throw new Error(`Guidance ${guidanceId} not found`)
  const guidance = node as GuidanceNode
  return updateNode(graph, guidanceId, {
    metadata: { ...guidance.metadata, status: "PROPOSED", proposal },
  }) as GuidanceNode
}

export function applyGuidancePatch(
  graph: KnowledgeGraph,
  guidanceId: string,
  proposal: Record<string, unknown>,
  actor: string,
  expectedTargetVersion?: number,
): { guidance: GuidanceNode; target: AnyNode } {
  const node = getNode(graph, guidanceId)
  if (!node || node.type !== "guidance") throw new Error(`Guidance ${guidanceId} not found`)
  let guidance = node as GuidanceNode
  const target = getNode(graph, guidance.metadata.target_node_id)
  if (!target) throw new Error(`Guidance target ${guidance.metadata.target_node_id} not found`)
  if (!guidance.metadata.impact_node_ids) {
    guidance = analyzeGuidance(graph, guidanceId).guidance
  }
  if (expectedTargetVersion !== undefined && target.version !== expectedTargetVersion) {
    throw new Error(`Guidance target version conflict: expected ${expectedTargetVersion}, current ${target.version}`)
  }
  const impactIds = new Set([guidance.metadata.target_node_id, ...(guidance.metadata.impact_node_ids || [])])
  const propagated = Array.isArray(proposal.updates)
    ? proposal.updates.filter((item): item is PropagatedUpdate => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false
      const value = item as Record<string, unknown>
      return typeof value.node_id === "string" && !!value.patch && typeof value.patch === "object" && !Array.isArray(value.patch)
    })
    : []
  for (const update of propagated) {
    if (!impactIds.has(update.node_id)) throw new Error(`Guidance propagation target ${update.node_id} was not identified by impact analysis`)
    const affected = getNode(graph, update.node_id)
    if (!affected) throw new Error(`Guidance propagation target ${update.node_id} not found`)
    if (update.expected_version !== undefined && affected.version !== update.expected_version) {
      throw new Error(`Guidance propagation target version conflict: ${update.node_id}`)
    }
  }
  const applyOne = (nodeToUpdate: AnyNode, patchToApply: Record<string, unknown>): AnyNode => {
    if (nodeToUpdate.type === "acceptance_criterion") {
      if (typeof patchToApply.text !== "string") throw new Error(`Acceptance criterion guidance for ${nodeToUpdate.id} must provide a text update`)
      return updateAcceptanceCriterionText(graph, nodeToUpdate.id, patchToApply.text, {
        actor,
        observation: typeof patchToApply.observation === "string" ? patchToApply.observation : undefined,
      })
    }
    const updates: Record<string, unknown> = {}
    for (const key of ["name", "description", "status"] as const) {
      if (patchToApply[key] !== undefined) updates[key] = patchToApply[key]
    }
    if (patchToApply.metadata && typeof patchToApply.metadata === "object" && !Array.isArray(patchToApply.metadata)) {
      updates.metadata = {
        ...(nodeToUpdate.metadata as Record<string, unknown>),
        ...(patchToApply.metadata as Record<string, unknown>),
      }
    }
    if (Object.keys(updates).length === 0) throw new Error(`Guidance proposal contains no supported updates for ${nodeToUpdate.id}`)
    return updateNode(graph, nodeToUpdate.id, { ...updates, created_by: actor } as Partial<AnyNode>)
  }
  const hasSupportedPatch = (nodeToUpdate: AnyNode, patchToApply: Record<string, unknown>): boolean => {
    if (nodeToUpdate.type === "acceptance_criterion") return typeof patchToApply.text === "string"
    return ["name", "description", "status", "metadata"].some((key) => {
      const value = patchToApply[key]
      return key === "metadata" ? !!value && typeof value === "object" && !Array.isArray(value) : value !== undefined
    })
  }
  if (!hasSupportedPatch(target, proposal)) throw new Error(`Guidance proposal contains no supported updates for ${target.id}`)
  for (const update of propagated) {
    if (!hasSupportedPatch(getNode(graph, update.node_id) as AnyNode, update.patch)) throw new Error(`Guidance proposal contains no supported updates for ${update.node_id}`)
  }
  if (target.type === "acceptance_criterion") {
    const updatedTarget = applyOne(target, proposal)
    for (const update of propagated) applyOne(getNode(graph, update.node_id) as AnyNode, update.patch)
    const updatedGuidance = updateNode(graph, guidanceId, {
      metadata: { ...guidance.metadata, status: "APPLIED", proposal, applied_target_ids: [target.id, ...propagated.map((update) => update.node_id)], applied_at: now() },
      created_by: actor,
    }) as GuidanceNode
    return { guidance: updatedGuidance, target: updatedTarget }
  }
  const updatedTarget = applyOne(target, proposal)
  for (const update of propagated) applyOne(getNode(graph, update.node_id) as AnyNode, update.patch)
  const updatedGuidance = updateNode(graph, guidanceId, {
    metadata: {
      ...guidance.metadata,
      status: "APPLIED",
      proposal,
      applied_target_ids: [target.id, ...propagated.map((update) => update.node_id)],
      applied_at: now(),
    },
    created_by: actor,
  }) as GuidanceNode
  return { guidance: updatedGuidance, target: updatedTarget }
}

export function rejectGuidance(graph: KnowledgeGraph, guidanceId: string, actor: string, resolution: string): GuidanceNode {
  const node = getNode(graph, guidanceId)
  if (!node || node.type !== "guidance") throw new Error(`Guidance ${guidanceId} not found`)
  return updateNode(graph, guidanceId, {
    metadata: { ...(node.metadata as GuidanceNode["metadata"]), status: "REJECTED", resolution },
    created_by: actor,
  }) as GuidanceNode
}
