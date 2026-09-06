import type { KnowledgeGraph } from "../domain/types.js"
import { execSync } from "child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"

export interface SyncResult {
  success: boolean
  action: string
  details: string
  conflicts?: ConflictItem[]
}

export interface ConflictItem {
  node_id: string
  field: string
  local_value: unknown
  remote_value: unknown
  resolution?: "local" | "remote" | "manual"
}

export interface SyncStatus {
  has_remote: boolean
  branch: string
  ahead: number
  behind: number
  dirty: boolean
  last_sync?: string
}

export interface MergeStrategy {
  auto_resolve: boolean
  field_priorities: Record<string, "local" | "remote">
}

const LOCK_FILE = ".sdd/sync.lock"
const SYNC_STATE_FILE = ".sdd/sync-state.json"

export interface SyncStatusOptions {
  /** Cache for sync status results. Reused if TTL not expired. */
  statusCache?: { status: SyncStatus; timestamp: number }
  /** Max age in ms for cached status (default: 10000 = 10s). */
  cacheTTL?: number
  /** Skip ahead/behind computation (faster, fewer git commands). */
  skipAheadBehind?: boolean
}

const syncStatusCache = new Map<string, { status: SyncStatus; timestamp: number }>()

export function getSyncStatus(projectDir: string, options?: SyncStatusOptions): SyncStatus {
  const ttl = options?.cacheTTL ?? 10000
  const cacheKey = projectDir

  // Check cache
  if (options?.statusCache) {
    if (Date.now() - options.statusCache.timestamp < ttl) return options.statusCache.status
  }
  const globalCached = syncStatusCache.get(cacheKey)
  if (globalCached && Date.now() - globalCached.timestamp < ttl) return globalCached.status

  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim()

    let ahead = 0
    let behind = 0
    if (!options?.skipAheadBehind) {
      ahead = parseInt(
        execSync("git rev-list --count @{u}..HEAD 2>/dev/null || echo 0", {
          cwd: projectDir,
          encoding: "utf-8",
          timeout: 5000,
        }).trim(),
      )
      behind = parseInt(
        execSync("git rev-list --count HEAD..@{u} 2>/dev/null || echo 0", {
          cwd: projectDir,
          encoding: "utf-8",
          timeout: 5000,
        }).trim(),
      )
    }

    const status = execSync("git status --porcelain", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim()

    const hasRemote = execSync("git remote -v", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim().length > 0

    const syncState = loadSyncState(projectDir)

    const result: SyncStatus = {
      has_remote: hasRemote,
      branch,
      ahead,
      behind,
      dirty: status.length > 0,
      last_sync: syncState?.last_sync,
    }

    // Store in cache
    if (options?.statusCache) {
      options.statusCache.status = result
      options.statusCache.timestamp = Date.now()
    }
    syncStatusCache.set(cacheKey, { status: result, timestamp: Date.now() })

    return result
  } catch {
    return {
      has_remote: false,
      branch: "unknown",
      ahead: 0,
      behind: 0,
      dirty: false,
    }
  }
}

export function acquireLock(projectDir: string, owner: string): boolean {
  const lockPath = join(projectDir, LOCK_FILE)
  const dir = dirname(lockPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf-8"))
      const lockAge = Date.now() - new Date(lock.timestamp).getTime()
      if (lockAge < 300000) {
        return false
      }
    } catch {
      // stale lock
    }
  }

  writeFileSync(lockPath, JSON.stringify({
    owner,
    timestamp: new Date().toISOString(),
  }), "utf-8")

  return true
}

export function releaseLock(projectDir: string): void {
  const lockPath = join(projectDir, LOCK_FILE)
  if (existsSync(lockPath)) {
    const lock = JSON.parse(readFileSync(lockPath, "utf-8"))
    if (lock.owner === process.env.USER || lock.owner === "current") {
      writeFileSync(lockPath, "", "utf-8")
    }
  }
}

export function pullLatest(projectDir: string): SyncResult {
  try {
    const status = getSyncStatus(projectDir)
    if (!status.has_remote) {
      return { success: false, action: "pull", details: "No remote configured" }
    }

    if (status.behind === 0) {
      return { success: true, action: "pull", details: "Already up to date" }
    }

    execSync("git pull --no-edit", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 30000,
    })

    saveSyncState(projectDir, { last_sync: new Date().toISOString() })

    return {
      success: true,
      action: "pull",
      details: `Pulled ${status.behind} commit(s) from remote`,
    }
  } catch (error) {
    return {
      success: false,
      action: "pull",
      details: `Pull failed: ${error instanceof Error ? error.message : "unknown error"}`,
    }
  }
}

export function pushChanges(projectDir: string, message: string): SyncResult {
  try {
    const status = getSyncStatus(projectDir)
    if (!status.has_remote) {
      return { success: false, action: "push", details: "No remote configured" }
    }

    execSync("git add .sdd/", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 10000,
    })

    execSync(`git commit -m "${message}" --allow-empty`, {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 10000,
    })

    execSync("git push", {
      cwd: projectDir,
      encoding: "utf-8",
      timeout: 30000,
    })

    saveSyncState(projectDir, { last_sync: new Date().toISOString() })

    return {
      success: true,
      action: "push",
      details: `Pushed changes to remote`,
    }
  } catch (error) {
    return {
      success: false,
      action: "push",
      details: `Push failed: ${error instanceof Error ? error.message : "unknown error"}`,
    }
  }
}

export interface ConflictDetectionOptions {
  /** Only compare these specific node IDs (skip others). */
  focusChangedNodes?: string[]
  /** Skip these node types entirely. */
  excludeNodeTypes?: string[]
  /** Max number of conflicts to report. */
  maxConflicts?: number
  /** Cache for conflict detection results. */
  conflictCache?: { conflicts: ConflictItem[]; timestamp: number; graphHash: string }
}

export function detectConflicts(
  localGraph: KnowledgeGraph,
  remoteGraphPath: string,
  options?: ConflictDetectionOptions,
): ConflictItem[] {
  const conflicts: ConflictItem[] = []

  if (!existsSync(remoteGraphPath)) return conflicts

  try {
    const remoteContent = readFileSync(remoteGraphPath, "utf-8")
    const remoteGraph = JSON.parse(remoteContent) as KnowledgeGraph

    // Check cache
    const graphHash = `${localGraph.nodes.length}_${remoteGraph.nodes.length}_${localGraph.metadata.updated_at}`
    if (options?.conflictCache && options.conflictCache.graphHash === graphHash) {
      return options.conflictCache.conflicts
    }

    const localNodeMap = new Map(localGraph.nodes.map((n) => [n.id, n]))
    const remoteNodeMap = new Map(remoteGraph.nodes.map((n) => [n.id, n]))

    // Determine which nodes to compare
    const nodesToCompare = options?.focusChangedNodes
      ? options.focusChangedNodes
      : [...localNodeMap.keys()]

    const maxConflicts = options?.maxConflicts ?? Infinity

    for (const nodeId of nodesToCompare) {
      if (conflicts.length >= maxConflicts) break

      const localNode = localNodeMap.get(nodeId)
      if (!localNode) continue

      // Skip excluded types
      if (options?.excludeNodeTypes?.includes(localNode.type)) continue

      const remoteNode = remoteNodeMap.get(nodeId)
      if (!remoteNode) continue

      if (localNode.updated_at !== remoteNode.updated_at) {
        const localMeta = localNode.metadata as Record<string, unknown>
        const remoteMeta = remoteNode.metadata as Record<string, unknown>

        for (const key of Object.keys(localMeta)) {
          if (conflicts.length >= maxConflicts) break
          if (JSON.stringify(localMeta[key]) !== JSON.stringify(remoteMeta[key])) {
            conflicts.push({
              node_id: nodeId,
              field: key,
              local_value: localMeta[key],
              remote_value: remoteMeta[key],
            })
          }
        }
      }
    }

    // Store in cache
    if (options?.conflictCache) {
      options.conflictCache.conflicts = conflicts
      options.conflictCache.timestamp = Date.now()
      options.conflictCache.graphHash = graphHash
    }
  } catch {
    // remote graph parse error
  }

  return conflicts
}

export function resolveConflict(
  conflict: ConflictItem,
  resolution: "local" | "remote",
): ConflictItem {
  return { ...conflict, resolution }
}

export function mergeGraphs(
  local: KnowledgeGraph,
  remote: KnowledgeGraph,
  strategy: MergeStrategy,
): KnowledgeGraph {
  const merged = { ...local }
  const remoteNodeMap = new Map(remote.nodes.map((n) => [n.id, n]))

  for (let i = 0; i < merged.nodes.length; i++) {
    const localNode = merged.nodes[i]
    const remoteNode = remoteNodeMap.get(localNode.id)

    if (remoteNode && new Date(remoteNode.updated_at) > new Date(localNode.updated_at)) {
      if (strategy.auto_resolve) {
        const priority = strategy.field_priorities[localNode.id] || "remote"
        if (priority === "remote") {
          merged.nodes[i] = remoteNode
        }
      }
    }
  }

  for (const remoteNode of remote.nodes) {
    if (!merged.nodes.find((n) => n.id === remoteNode.id)) {
      merged.nodes.push(remoteNode)
    }
  }

  merged.metadata.updated_at = new Date().toISOString()

  return merged
}

function loadSyncState(projectDir: string): { last_sync?: string } | null {
  const path = join(projectDir, SYNC_STATE_FILE)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

function saveSyncState(projectDir: string, state: { last_sync?: string }): void {
  const path = join(projectDir, SYNC_STATE_FILE)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8")
}

export function formatSyncStatus(status: SyncStatus): string {
  const lines = [
    "## Sync Status",
    "",
    `- **Branch:** ${status.branch}`,
    `- **Remote:** ${status.has_remote ? "✅ Configured" : "❌ Not configured"}`,
    `- **Ahead:** ${status.ahead} commit(s)`,
    `- **Behind:** ${status.behind} commit(s)`,
    `- **Dirty:** ${status.dirty ? "⚠️ Yes" : "✅ No"}`,
  ]

  if (status.last_sync) {
    lines.push(`- **Last Sync:** ${status.last_sync}`)
  }

  if (status.behind > 0) {
    lines.push("\n⚠️ **Run `sdd.sync_pull` to get latest changes**")
  }

  if (status.ahead > 0) {
    lines.push("\n📤 **Run `sdd.sync_push` to share your changes**")
  }

  return lines.join("\n")
}
