import type { KnowledgeGraph, ChangeNode } from "../domain/types.js"
import { getNode, updateNode } from "../graph/engine.js"
import { execSync } from "child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from "fs"
import { join, dirname } from "path"

export interface RollbackResult {
  success: boolean
  method: "git" | "snapshot" | "backup" | "failed"
  details: string
  restored_files?: string[]
}

export interface RollbackSnapshot {
  id: string
  change_id: string
  timestamp: string
  graph_state: KnowledgeGraph
  backed_up_files: Array<{ path: string; backup_path: string }>
}

export interface RollbackHistory {
  rollbacks: Array<{
    id: string
    change_id: string
    timestamp: string
    method: string
    success: boolean
  }>
}

const SNAPSHOTS_DIR = ".sdd/snapshots"
const BACKUPS_DIR = ".sdd/backups"
const ROLLBACK_HISTORY_FILE = ".sdd/rollback-history.json"

export function createSnapshot(
  graph: KnowledgeGraph,
  changeId: string,
  projectDir: string,
): RollbackSnapshot {
  const snapshotId = `snap_${Date.now()}`
  const snapshot: RollbackSnapshot = {
    id: snapshotId,
    change_id: changeId,
    timestamp: new Date().toISOString(),
    graph_state: JSON.parse(JSON.stringify(graph)),
    backed_up_files: [],
  }

  const change = getNode(graph, changeId) as ChangeNode | undefined
  if (change && change.metadata.affected_files) {
    const backupDir = join(projectDir, BACKUPS_DIR, snapshotId)
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })

    for (const file of change.metadata.affected_files) {
      const fullPath = join(projectDir, file)
      if (existsSync(fullPath)) {
        const backupPath = join(backupDir, file.replace(/\//g, "_"))
        try {
          copyFileSync(fullPath, backupPath)
          snapshot.backed_up_files.push({ path: file, backup_path: backupPath })
        } catch {
          // skip files that can't be copied
        }
      }
    }
  }

  const snapshotsDir = join(projectDir, SNAPSHOTS_DIR)
  if (!existsSync(snapshotsDir)) mkdirSync(snapshotsDir, { recursive: true })
  writeFileSync(join(snapshotsDir, `${snapshotId}.json`), JSON.stringify(snapshot, null, 2), "utf-8")

  return snapshot
}

export function rollbackByGit(
  projectDir: string,
  changeId: string,
  options?: Pick<RollbackOptions, 'commitCache'>,
): RollbackResult {
  try {
    const commitHash = findCommitForChange(projectDir, changeId, options?.commitCache)
    if (!commitHash) {
      return { success: false, method: "git", details: "No commit found for this change" }
    }

    execSync(`git revert ${commitHash} --no-edit`, {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 30000,
    })

    return {
      success: true,
      method: "git",
      details: `Successfully reverted commit ${commitHash}`,
    }
  } catch (error) {
    return {
      success: false,
      method: "git",
      details: `Git revert failed: ${error instanceof Error ? error.message : "unknown"}`,
    }
  }
}

export function rollbackBySnapshot(
  graph: KnowledgeGraph,
  changeId: string,
  projectDir: string,
  options?: Pick<RollbackOptions, 'snapshotIndex'>,
): RollbackResult {
  const snapshot = findSnapshot(projectDir, changeId, options)
  if (!snapshot) {
    return { success: false, method: "snapshot", details: "No snapshot found for this change" }
  }

  const restoredFiles: string[] = []

  for (const backedUp of snapshot.backed_up_files) {
    if (existsSync(backedUp.backup_path)) {
      const fullPath = join(projectDir, backedUp.path)
      const dir = dirname(fullPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      try {
        copyFileSync(backedUp.backup_path, fullPath)
        restoredFiles.push(backedUp.path)
      } catch {
        // skip
      }
    }
  }

  const change = getNode(graph, changeId) as ChangeNode | undefined
  if (change) {
    change.status = "ROLLED_BACK"
    const metadata = change.metadata as Record<string, unknown>
    metadata.rollback_snapshot = snapshot.id
    metadata.rollback_at = new Date().toISOString()
    updateNode(graph, changeId, {
      status: "ROLLED_BACK",
      metadata,
    })
  }

  return {
    success: true,
    method: "snapshot",
    details: `Restored from snapshot ${snapshot.id}`,
    restored_files: restoredFiles,
  }
}

export function rollbackByBackup(
  _graph: KnowledgeGraph,
  changeId: string,
  projectDir: string,
  options?: Pick<RollbackOptions, 'snapshotIndex'>,
): RollbackResult {
  const snapshot = findSnapshot(projectDir, changeId, options)
  if (!snapshot) {
    return { success: false, method: "backup", details: "No backup found for this change" }
  }

  const restoredFiles: string[] = []

  for (const backedUp of snapshot.backed_up_files) {
    if (existsSync(backedUp.backup_path)) {
      const fullPath = join(projectDir, backedUp.path)
      const dir = dirname(fullPath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      try {
        copyFileSync(backedUp.backup_path, fullPath)
        restoredFiles.push(backedUp.path)
      } catch {
        // skip
      }
    }
  }

  return {
    success: true,
    method: "backup",
    details: `Restored ${restoredFiles.length} files from backup`,
    restored_files: restoredFiles,
  }
}

export function executeRollback(
  graph: KnowledgeGraph,
  changeId: string,
  projectDir: string,
  options?: RollbackOptions,
): RollbackResult {
  let result = rollbackByGit(projectDir, changeId, options)
  if (result.success) {
    recordRollback(projectDir, changeId, result)
    return result
  }

  result = rollbackBySnapshot(graph, changeId, projectDir, options)
  if (result.success) {
    recordRollback(projectDir, changeId, result)
    return result
  }

  result = rollbackByBackup(graph, changeId, projectDir, options)
  if (result.success) {
    recordRollback(projectDir, changeId, result)
    return result
  }

  result = { success: false, method: "failed", details: "All rollback methods failed" }
  recordRollback(projectDir, changeId, result)
  return result
}

function findCommitForChange(
  projectDir: string,
  changeId: string,
  commitCache?: Map<string, string | null>,
): string | null {
  // Fast path: use cache
  if (commitCache?.has(changeId)) return commitCache.get(changeId)!

  let result: string | null = null
  try {
    const log = execSync(`git log --all --oneline --grep="${changeId}"`, {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 10000,
    }).trim()

    if (log) {
      const firstLine = log.split("\n")[0]
      result = firstLine.split(" ")[0]
    }
  } catch {
    // git not available or no matching commit
  }

  commitCache?.set(changeId, result)
  return result
}

export interface RollbackOptions {
  /** Index for O(1) snapshot lookup (changeId → snapshotId). */
  snapshotIndex?: Map<string, string>
  /** Only look for these specific change IDs. */
  focusChangeId?: string[]
  /** Cache for git commit lookups (changeId → commitHash). */
  commitCache?: Map<string, string | null>
  /** Only look for commits matching these change IDs. */
  focusChangeIds?: string[]
}

function findSnapshot(
  projectDir: string,
  changeId: string,
  options?: Pick<RollbackOptions, 'snapshotIndex' | 'focusChangeId'>,
): RollbackSnapshot | null {
  // Fast path: use index
  if (options?.snapshotIndex?.has(changeId)) {
    const snapshotId = options.snapshotIndex.get(changeId)!
    const snapshotPath = join(projectDir, SNAPSHOTS_DIR, `${snapshotId}.json`)
    if (existsSync(snapshotPath)) {
      try {
        return JSON.parse(readFileSync(snapshotPath, "utf-8")) as RollbackSnapshot
      } catch { /* skip */ }
    }
  }

  const snapshotsDir = join(projectDir, SNAPSHOTS_DIR)
  if (!existsSync(snapshotsDir)) return null

  const files = readdirSync(snapshotsDir).filter((f) => f.endsWith(".json"))
  for (const file of files) {
    try {
      const snapshot = JSON.parse(readFileSync(join(snapshotsDir, file), "utf-8")) as RollbackSnapshot
      if (snapshot.change_id === changeId) {
        options?.snapshotIndex?.set(snapshot.change_id, snapshot.id)
        return snapshot
      }
    } catch {
      // skip
    }
  }

  return null
}

function recordRollback(
  projectDir: string,
  changeId: string,
  result: RollbackResult,
): void {
  const history = loadRollbackHistory(projectDir)
  history.rollbacks.push({
    id: `rb_${Date.now()}`,
    change_id: changeId,
    timestamp: new Date().toISOString(),
    method: result.method,
    success: result.success,
  })
  saveRollbackHistory(projectDir, history)
}

export function loadRollbackHistory(projectDir: string): RollbackHistory {
  const path = join(projectDir, ROLLBACK_HISTORY_FILE)
  if (!existsSync(path)) return { rollbacks: [] }
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return { rollbacks: [] }
  }
}

function saveRollbackHistory(projectDir: string, history: RollbackHistory): void {
  const path = join(projectDir, ROLLBACK_HISTORY_FILE)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(history, null, 2), "utf-8")
}

export function formatRollbackResult(result: RollbackResult): string {
  const lines = [
    "## Rollback Result",
    "",
    `- **Success:** ${result.success ? "✅ Yes" : "❌ No"}`,
    `- **Method:** ${result.method}`,
    `- **Details:** ${result.details}`,
  ]

  if (result.restored_files && result.restored_files.length > 0) {
    lines.push("\n### Restored Files")
    for (const file of result.restored_files) {
      lines.push(`- ${file}`)
    }
  }

  return lines.join("\n")
}

export function formatRollbackHistory(history: RollbackHistory): string {
  const lines = [
    "## Rollback History",
    "",
  ]

  if (history.rollbacks.length === 0) {
    lines.push("No rollbacks recorded.")
    return lines.join("\n")
  }

  for (const rb of history.rollbacks) {
    const status = rb.success ? "✅" : "❌"
    lines.push(`- ${status} **${rb.change_id}** (${rb.method}) at ${rb.timestamp}`)
  }

  return lines.join("\n")
}
