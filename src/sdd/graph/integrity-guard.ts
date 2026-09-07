/**
 * Graph Integrity Guard (Anti-Bypass Layer)
 *
 * Tracks a checksum of the graph state after every legitimate save.
 * On load, validates that the graph hasn't been modified outside the
 * SDD workflow tools (e.g., via Python scripts, direct YAML/DB edits).
 *
 * This prevents agents from bypassing enforcement by:
 * 1. Editing graph.yaml directly with Python
 * 2. Manipulating graph.db with raw SQL
 * 3. Editing graph files with shell commands
 */

import { createHash } from "crypto"
import { existsSync, readFileSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { atomicWriteFile } from "../cache/atomic.js"
import { stableSerialize } from "../cache/fingerprint.js"

const INTEGRITY_FILE = ".sdd/graph-integrity.json"
const CHECKSUM_HISTORY_SIZE = 50

export interface IntegrityState {
  /** Last known checksum of the graph when saved through SDD tools */
  last合法Checksum: string
  /** Timestamp of last legitimate save */
  last合法Save: number
  /** Number of consecutive tamper detections */
  tamperCount: number
  /** Checksum history for rollback detection */
  checksumHistory: Array<{
    checksum: string
    timestamp: number
    nodeCount: number
    relCount: number
    changeId?: string
  }>
  /** Whether the graph is currently flagged as tampered */
  tampered: boolean
  /** List of detected tamper events */
  tamperLog: Array<{
    timestamp: number
    detected_checksum: string
    expected_checksum: string
    node_count_diff: number
    rel_count_diff: number
  }>
}

/**
 * Compute a deterministic checksum of a KnowledgeGraph.
 * Includes nodes, relationships, and metadata for full integrity.
 */
export function computeGraphChecksum(graph: {
  nodes: unknown[]
  relationships: unknown[]
  metadata: unknown
  project_id?: unknown
  version?: unknown
}): string {
  const payload = stableSerialize({
    project_id: graph.project_id,
    version: graph.version,
    metadata: graph.metadata,
    nodes: [...graph.nodes].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
    relationships: [...graph.relationships].sort((a, b) => stableSerialize(a).localeCompare(stableSerialize(b))),
  })
  return createHash("sha256").update(payload).digest("hex")
}

/**
 * Load integrity state from disk.
 */
function loadIntegrityState(projectDir: string): IntegrityState {
  const path = join(projectDir, INTEGRITY_FILE)
  if (!existsSync(path)) {
    return {
      last合法Checksum: "",
      last合法Save: 0,
      tamperCount: 0,
      checksumHistory: [],
      tampered: false,
      tamperLog: [],
    }
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"))
    // Migration: handle old format without tamper fields
    return {
      last合法Checksum: data.last合法Checksum || data.lastChecksum || "",
      last合法Save: data.last合法Save || data.lastSave || 0,
      tamperCount: data.tamperCount || 0,
      checksumHistory: data.checksumHistory || [],
      tampered: data.tampered || false,
      tamperLog: data.tamperLog || [],
    }
  } catch {
    return {
      last合法Checksum: "",
      last合法Save: 0,
      tamperCount: 0,
      checksumHistory: [],
      // A corrupt integrity file is not equivalent to a clean first run.
      // Keep the graph blocked until an explicit legitimate save recreates it.
      tampered: true,
      tamperLog: [],
    }
  }
}

/**
 * Save integrity state to disk.
 */
function saveIntegrityState(projectDir: string, state: IntegrityState): void {
  const path = join(projectDir, INTEGRITY_FILE)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  atomicWriteFile(path, JSON.stringify(state, null, 2))
}

/**
 * Record a legitimate save (called after every SDD tool mutation).
 * Updates the checksum to the current graph state.
 */
export function recordLegitimateSave(
  projectDir: string,
  graph: { nodes: unknown[]; relationships: unknown[]; metadata: unknown; project_id?: unknown; version?: unknown },
  changeId?: string,
): string {
  const checksum = computeGraphChecksum(graph)
  const state = loadIntegrityState(projectDir)

  state.last合法Checksum = checksum
  state.last合法Save = Date.now()
  state.tampered = false
  state.tamperCount = 0

  state.checksumHistory.push({
    checksum,
    timestamp: Date.now(),
    nodeCount: graph.nodes.length,
    relCount: graph.relationships.length,
    changeId,
  })

  // Keep history bounded
  if (state.checksumHistory.length > CHECKSUM_HISTORY_SIZE) {
    state.checksumHistory = state.checksumHistory.slice(-CHECKSUM_HISTORY_SIZE)
  }

  saveIntegrityState(projectDir, state)
  return checksum
}

/**
 * Validate the current graph against the last known legitimate state.
 * Returns tamper detection result.
 */
export function validateGraphIntegrity(
  projectDir: string,
  graph: { nodes: unknown[]; relationships: unknown[]; metadata: unknown; project_id?: unknown; version?: unknown },
): {
  valid: boolean
  tampered: boolean
  reason?: string
  currentChecksum: string
  expectedChecksum: string
  nodeCountDiff: number
  relCountDiff: number
} {
  const state = loadIntegrityState(projectDir)
  const currentChecksum = computeGraphChecksum(graph)

  // No baseline yet — accept only a genuinely new project. A corrupt integrity
  // file is represented by tampered=true and must not be silently reset.
  if (!state.last合法Checksum) {
    if (state.tampered) {
      return {
        valid: false,
        tampered: true,
        reason: "Integrity metadata is corrupt or unreadable; recreate it through a legitimate SDD save.",
        currentChecksum,
        expectedChecksum: "",
        nodeCountDiff: 0,
        relCountDiff: 0,
      }
    }
    return {
      valid: true,
      tampered: false,
      currentChecksum,
      expectedChecksum: "",
      nodeCountDiff: 0,
      relCountDiff: 0,
    }
  }

  if (currentChecksum === state.last合法Checksum) {
    return {
      valid: true,
      tampered: false,
      currentChecksum,
      expectedChecksum: state.last合法Checksum,
      nodeCountDiff: 0,
      relCountDiff: 0,
    }
  }

  // Checksum mismatch — compute diffs for diagnostics
  const lastEntry = state.checksumHistory[state.checksumHistory.length - 1]
  const nodeCountDiff = lastEntry ? graph.nodes.length - lastEntry.nodeCount : 0
  const relCountDiff = lastEntry ? graph.relationships.length - lastEntry.relCount : 0

  // A checksum is trusted only if this exact graph was recorded by a
  // legitimate save. Looking at a recent Change ID is insufficient because a
  // direct edit can happen after an unrelated change.
  const timeSinceLastSave = Date.now() - state.last合法Save
  const isSuspicious = !state.checksumHistory.some(entry => entry.checksum === currentChecksum)

  if (isSuspicious) {
    state.tampered = true
    state.tamperCount++
    state.tamperLog.push({
      timestamp: Date.now(),
      detected_checksum: currentChecksum,
      expected_checksum: state.last合法Checksum,
      node_count_diff: nodeCountDiff,
      rel_count_diff: relCountDiff,
    })

    // Keep log bounded
    if (state.tamperLog.length > 20) {
      state.tamperLog = state.tamperLog.slice(-20)
    }

    saveIntegrityState(projectDir, state)

    return {
      valid: false,
      tampered: true,
      reason:
        `⚠️ TAMPER DETECTED: Graph was modified outside the SDD workflow.\n` +
        `Expected checksum: ${state.last合法Checksum}\n` +
        `Current checksum:  ${currentChecksum}\n` +
        `Node diff: ${nodeCountDiff > 0 ? "+" : ""}${nodeCountDiff}, ` +
        `Relationship diff: ${relCountDiff > 0 ? "+" : ""}${relCountDiff}\n` +
        `Time since last legitimate save: ${Math.round(timeSinceLastSave / 1000)}s\n\n` +
        `The graph appears to have been modified directly (e.g., via Python script, ` +
        `shell command, or direct file edit) instead of through SDD tools.\n\n` +
        `This modification has been logged. To fix:\n` +
        `1. Run sdd.enforce to create a proper Change node\n` +
        `2. Make changes through SDD tools only\n` +
        `3. The tamper flag will be cleared on the next legitimate save`,
      currentChecksum,
      expectedChecksum: state.last合法Checksum,
      nodeCountDiff,
      relCountDiff,
    }
  }

  // Graph changed but through legitimate means — update baseline
  saveIntegrityState(projectDir, {
    ...state,
    last合法Checksum: currentChecksum,
    last合法Save: Date.now(),
    tampered: false,
  })

  return {
    valid: true,
    tampered: false,
    currentChecksum,
    expectedChecksum: state.last合法Checksum,
    nodeCountDiff,
    relCountDiff,
  }
}

/**
 * Get the tamper log for auditing.
 */
export function getTamperLog(projectDir: string): IntegrityState["tamperLog"] {
  const state = loadIntegrityState(projectDir)
  return state.tamperLog
}

/**
 * Check if the graph is currently flagged as tampered.
 */
export function isGraphTampered(projectDir: string): boolean {
  const state = loadIntegrityState(projectDir)
  return state.tampered
}

/**
 * Clear the tamper flag (only after legitimate workflow completion).
 */
export function clearTamperFlag(projectDir: string): void {
  const state = loadIntegrityState(projectDir)
  state.tampered = false
  state.tamperCount = 0
  saveIntegrityState(projectDir, state)
}

/**
 * Format tamper detection result for display.
 */
export function formatTamperReport(
  result: ReturnType<typeof validateGraphIntegrity>,
): string {
  if (!result.tampered) {
    return "✅ Graph integrity: VALID — no tampering detected."
  }

  const lines = [
    "## 🚨 GRAPH TAMPER DETECTED",
    "",
    "The SDD Knowledge Graph has been modified outside the approved workflow.",
    "",
    "### Details",
    `- **Expected checksum:** \`${result.expectedChecksum}\``,
    `- **Actual checksum:** \`${result.currentChecksum}\``,
    `- **Node count change:** ${result.nodeCountDiff > 0 ? "+" : ""}${result.nodeCountDiff}`,
    `- **Relationship count change:** ${result.relCountDiff > 0 ? "+" : ""}${result.relCountDiff}`,
    "",
    "### What happened",
    "Someone (likely the AI agent) modified the graph data files directly",
    "(e.g., via Python script or shell command) instead of using SDD tools.",
    "",
    "### Why this is a problem",
    "- No Change node was created for audit trail",
    "- No approval workflow was followed",
    "- No impact analysis was performed",
    "- Specification validation was skipped",
    "",
    "### How to fix",
    "1. Revert the unauthorized changes (git checkout .sdd/graph.yaml)",
    "2. Use `sdd.enforce` → `sdd.update_from_answers` → `sdd.approve_change`",
    "3. Make changes through SDD tools only",
    "",
    `### Tamper logged at: ${new Date().toISOString()}`,
  ]

  return lines.join("\n")
}
