/**
 * Graph State Snapshot — Captura o estado do grafo para decisão de visibilidade de tools.
 *
 * Cache por sessão invalidado por fingerprint criptográfico do armazenamento.
 *
 * Consumido por: state-gate.ts, hooks.ts
 */

import { createRepository } from "../../sdd/persistence/repository.js"
import { existsSync } from "fs"
import { join } from "path"
import { fileSignature } from "../../sdd/cache/fingerprint.js"
import { sddDebug } from "../../sdd/log.js"

export type GraphState =
  | "error"
  | "uninitialized"
  | "empty"
  | "partial"
  | "ready"
  | "has_change"
  | "has_approved_change"
  | "emergency"

export interface GraphSnapshot {
  state: GraphState
  nodeCount: number
  relationshipCount: number
  nodeTypes: string[]
  hasSpecNodes: boolean
  hasChanges: boolean
  pendingChangeCount: number
  approvedChangeCount: number
  hasWorkflow: boolean
  /** Timestamp de criação do snapshot */
  timestamp: number
}

const SPEC_NODE_TYPES = ["feature", "entity", "requirement", "architecture_component", "module"]

let cachedSnapshot: GraphSnapshot | null = null
let cachedDirectory: string | null = null
let cachedSourceSignature: string | null = null

function sourceSignature(directory: string): string {
  const paths = [
    join(directory, ".sdd", "graph.yaml"),
    join(directory, ".sdd", "graph.db"),
    join(directory, ".sdd", "graph.db-wal"),
    join(directory, ".sdd", "graph.db-shm"),
  ]
    .filter(existsSync)
  return fileSignature(paths)
}

/**
 * Captura o estado atual do grafo (com cache).
 * O cache só é reutilizado quando o conteúdo persistido não mudou.
 */
export function getGraphSnapshot(directory: string): GraphSnapshot {
  const signature = sourceSignature(directory)
  if (cachedSnapshot && cachedDirectory === directory && cachedSourceSignature === signature) {
    return cachedSnapshot
  }

  const snapshot = captureSnapshot(directory)
  cachedSnapshot = snapshot
  cachedDirectory = directory
  cachedSourceSignature = signature
  return snapshot
}

/**
 * Força refresh do cache (após mutações no grafo).
 */
export function invalidateSnapshotCache(): void {
  cachedSnapshot = null
  cachedDirectory = null
  cachedSourceSignature = null
}

function captureSnapshot(directory: string): GraphSnapshot {
  const now = Date.now()

  try {
    const repo = createRepository(directory)
    if (!repo.isInitialized()) {
      return {
        state: "uninitialized",
        nodeCount: 0, relationshipCount: 0, nodeTypes: [],
        hasSpecNodes: false, hasChanges: false,
        pendingChangeCount: 0, approvedChangeCount: 0,
        hasWorkflow: false, timestamp: now,
      }
    }

    const graph = repo.loadGraph()
    const nodeTypes = [...new Set(graph.nodes.map(n => n.type))]
    const hasSpecNodes = graph.nodes.some(n => SPEC_NODE_TYPES.includes(n.type))
    const changes = graph.nodes.filter(n => n.type === "change")
    const pendingChanges = changes.filter(c => ["DRAFT", "PROPOSED"].includes(c.status))
    const approvedChanges = changes.filter(c => c.status === "APPROVED")

    // Detectar emergência (hotfix)
    const hasEmergency = changes.some(c =>
      c.name.toLowerCase().includes("hotfix") ||
      c.name.toLowerCase().includes("emergency") ||
      (c.metadata as Record<string, unknown>)?.approval_level === "POST_HOC"
    )

    // Detectar workflow ativo
    let hasWorkflow = false
    try {
      const { getWorkflowState } = require("../../sdd/enforcement/workflow-tracker.js")
      const wfState = getWorkflowState(directory)
      hasWorkflow = wfState.enforced === true
    } catch (error) { sddDebug("snapshot", "Failed to read workflow state") }

    // Determinar estado
    let state: GraphState
    if (hasEmergency) {
      state = "emergency"
    } else if (approvedChanges.length > 0) {
      state = "has_approved_change"
    } else if (pendingChanges.length > 0) {
      state = "has_change"
    } else if (graph.nodes.length <= 1) {
      state = "empty"
    } else if (!hasSpecNodes) {
      state = "partial"
    } else {
      state = "ready"
    }

    return {
      state,
      nodeCount: graph.nodes.length,
      relationshipCount: graph.relationships.length,
      nodeTypes,
      hasSpecNodes,
      hasChanges: changes.length > 0,
      pendingChangeCount: pendingChanges.length,
      approvedChangeCount: approvedChanges.length,
      hasWorkflow,
      timestamp: now,
    }
  } catch {
    return {
      state: "error",
      nodeCount: 0, relationshipCount: 0, nodeTypes: [],
      hasSpecNodes: false, hasChanges: false,
      pendingChangeCount: 0, approvedChangeCount: 0,
      hasWorkflow: false, timestamp: now,
    }
  }
}

/**
 * Descrição legível do estado para debugging.
 */
export function formatGraphState(snapshot: GraphSnapshot): string {
  const stateLabels: Record<GraphState, string> = {
    error: "⚠️ Erro ao ler o grafo",
    uninitialized: "❌ Não inicializado",
    empty: "📭 Grafo vazio",
    partial: "⚠️ Parcial (sem spec nodes)",
    ready: "✅ Pronto",
    has_change: "📝 Com changes pendentes",
    has_approved_change: "🟢 Com change aprovada",
    emergency: "🚨 Emergência (hotfix)",
  }

  return [
    `Estado: ${stateLabels[snapshot.state]}`,
    `Nós: ${snapshot.nodeCount} | Relações: ${snapshot.relationshipCount}`,
    `Spec nodes: ${snapshot.hasSpecNodes ? "sim" : "não"}`,
    `Changes: ${snapshot.pendingChangeCount} pendente(s), ${snapshot.approvedChangeCount} aprovada(s)`,
    `Workflow: ${snapshot.hasWorkflow ? "ativo" : "inativo"}`,
  ].join("\n")
}
