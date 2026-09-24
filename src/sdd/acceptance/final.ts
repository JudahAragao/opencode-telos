import type { ChangeNode, KnowledgeGraph } from "../domain/types.js"
import { getNode, updateNode } from "../graph/engine.js"

export type FinalAcceptanceStatus = "PENDING" | "ACCEPTED" | "REJECTED"

export interface FinalAcceptanceInput {
  actor: string
  observation?: string
  evidence?: Array<Record<string, unknown>>
  expected_version?: number
}

export interface FinalAcceptanceResult {
  change: ChangeNode
  previous_status: FinalAcceptanceStatus
  status: FinalAcceptanceStatus
  actor: string
  timestamp: string
}

export function transitionFinalAcceptance(
  graph: KnowledgeGraph,
  changeId: string,
  status: Exclude<FinalAcceptanceStatus, "PENDING">,
  input: FinalAcceptanceInput,
): FinalAcceptanceResult {
  const node = getNode(graph, changeId)
  if (!node || node.type !== "change") throw new Error(`Change ${changeId} not found`)
  const change = node as ChangeNode
  if (input.expected_version !== undefined && change.version !== input.expected_version) {
    throw new Error(`Change ${changeId} version conflict: expected ${input.expected_version}, current ${change.version}`)
  }
  const current = (change.metadata.final_acceptance as { status?: FinalAcceptanceStatus } | undefined)?.status || "PENDING"
  const timestamp = new Date().toISOString()
  const updated = updateNode(graph, changeId, {
    metadata: {
      ...change.metadata,
      final_acceptance: {
        status,
        actor: input.actor,
        accepted_at: timestamp,
        observation: input.observation,
        evidence: input.evidence,
        previous_status: current,
      },
    },
  }) as ChangeNode
  return { change: updated, previous_status: current, status, actor: input.actor, timestamp }
}

export function getFinalAcceptanceStatus(change: ChangeNode): FinalAcceptanceStatus {
  return (change.metadata.final_acceptance as { status?: FinalAcceptanceStatus } | undefined)?.status || "PENDING"
}
