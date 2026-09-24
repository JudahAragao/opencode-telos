import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship } from "../domain/types.js"
import { DEFAULT_SDD_CONFIG, type SddConfig } from "../domain/types.js"
import { GraphIndices } from "../graph/index.js"
import { existsSync, readFileSync, renameSync } from "fs"
import { join } from "path"
import { sddDebug } from "../log.js"

// ── Sentinel helpers ─────────────────────────────────────────────────────────

/**
 * Path of the canonical backend sentinel file.
 * When present, its content ("yaml" | "sqlite") is the authoritative backend
 * decision — no timestamp comparisons needed.
 */
function sentinelPath(projectDir: string): string {
  return join(projectDir, ".sdd", "storage-backend")
}

/**
 * Read the sentinel. Returns undefined when not present or unreadable.
 */
function readSentinel(projectDir: string): "yaml" | "sqlite" | undefined {
  const p = sentinelPath(projectDir)
  if (!existsSync(p)) return undefined
  try {
    const v = readFileSync(p, "utf-8").trim()
    if (v === "yaml" || v === "sqlite") return v
  } catch {}
  return undefined
}

/**
 * Write the sentinel atomically.
 * Called after every successful migration and during auto-heal.
 */
export function writeSentinel(projectDir: string, backend: "yaml" | "sqlite"): void {
  const { atomicWriteFile } = require("../cache/atomic.js")
  atomicWriteFile(sentinelPath(projectDir), backend)
}

/**
 * Unified interface for graph storage.
 * Both YAML and SQLite implementations satisfy this contract.
 */
export interface GraphRepository {
  /** Check if SDD is initialized (graph file/db exists) */
  isInitialized(): boolean

  /** Load the full graph into memory */
  loadGraph(): KnowledgeGraph

  /** Save the full graph (and update cache/indices) */
  saveGraph(graph: KnowledgeGraph): void

  /** Get pre-computed indices for O(1) queries */
  getIndices(): GraphIndices

  /** Get the underlying storage type */
  getStorageType(): "yaml" | "sqlite"

  /** Check if the cache is still valid */
  isCacheValid(): boolean

  /** Invalidate the in-memory cache */
  invalidateCache(): void

  /** Ensure the .sdd directory structure exists */
  ensureSddDir(): void

  /** Create a new project graph */
  createProject(projectId: string, name: string, description?: string, purpose?: "documentation" | "reverse_engineering" | "greenfield"): KnowledgeGraph

  /** Create a snapshot of the current state */
  createSnapshot(description: string): string

  /** List available snapshots */
  listSnapshots(): string[]

  /** Migrate to a different storage backend */
  migrateTo(target: "yaml" | "sqlite", projectDir: string): GraphRepository

  /** Get node count without loading full graph (optimized) */
  getNodeCount(): number

  /** Get relationship count without loading full graph (optimized) */
  getRelationshipCount(): number

  /** Get nodes by type without loading full graph (optimized for large graphs) */
  getNodesByType?(type: NodeType): AnyNode[]

  /** Get nodes by status without loading full graph (optimized for large graphs) */
  getNodesByStatus?(status: NodeStatus): AnyNode[]

  /** Get a single node by ID without loading full graph (optimized for large graphs) */
  getNodeById?(id: string): AnyNode | undefined

  /** Get relationships for a node without loading full graph (optimized for large graphs) */
  getRelationshipsForNode?(nodeId: string): Relationship[]
}

const MIGRATION_THRESHOLD = 1000

// ── Backup guard ─────────────────────────────────────────────────────────────

/**
 * Extensions that identify archived/backup files.
 * These files must NEVER be opened as an active graph — they are read-only
 * archives kept only for disaster-recovery by humans.
 */
const BACKUP_EXTENSIONS = [".bak", ".bk", ".backup"]

function isBackupPath(filePath: string): boolean {
  return BACKUP_EXTENSIONS.some((ext) => filePath.endsWith(ext))
}

/**
 * Guard called before any graph file is opened.
 * Throws a clear error if the caller accidentally targets a backup.
 */
function assertNotBackup(filePath: string): void {
  if (isBackupPath(filePath)) {
    throw new Error(
      `[SDD] Attempted to read backup file as active graph: ${filePath}\n` +
      `Backup files (.bak, .bk, .backup) are archives for disaster recovery only.\n` +
      `They must not be read, modified, or removed by the plugin or the LLM.\n` +
      `Active graph files are: .sdd/graph.yaml (YAML) and .sdd/graph.db (SQLite).`,
    )
  }
}

// ── Conflict resolution ──────────────────────────────────────────────────────

/**
 * Both graph.yaml and graph.db exist without a sentinel — this is a legacy
 * state (project migrated before Fix 4a) or the result of a crash during
 * rename. Perform an intelligent analysis to pick the canonical backend.
 *
 * Decision algorithm:
 * 1. Parse updated_at from both graphs (O(1) for SQLite, small YAML parse).
 * 2. The graph with the more recent updated_at is the active one.
 * 3. If timestamps are identical (migrated in the same millisecond):
 *    → SQLite wins. Rationale: the db was created because the project crossed
 *      the migration threshold; it is always at least as fresh as the YAML.
 * 4. Write the sentinel so this analysis never runs again.
 * 5. Return a repo for the winning backend.
 *
 * The result is also surfaced to sdd.check_migrations so the LLM learns what
 * happened and why.
 */
function resolveConflictingBackends(
  projectDir: string,
  yamlPath: string,
  dbPath: string,
): { repo: GraphRepository; winner: "yaml" | "sqlite"; reason: string } {
  const { SqliteGraphRepository } = require("./sqlite.js")
  const { YamlGraphRepository } = require("./yaml.js")

  let sqliteTime = 0
  let yamlTime = 0
  let sqliteNodeCount = 0
  let yamlNodeCount = 0
  let parseError = ""

  try {
    const sqliteRepo = new SqliteGraphRepository(projectDir)
    const sqliteGraph = sqliteRepo.loadGraph()
    sqliteTime = Date.parse(sqliteGraph.metadata.updated_at) || 0
    sqliteNodeCount = sqliteGraph.nodes.length
  } catch (e) {
    parseError += `SQLite read failed: ${e}. `
  }

  try {
    const yamlRepo = new YamlGraphRepository(projectDir)
    const yamlGraph = yamlRepo.loadGraph()
    yamlTime = Date.parse(yamlGraph.metadata.updated_at) || 0
    yamlNodeCount = yamlGraph.nodes.length
  } catch (e) {
    parseError += `YAML read failed: ${e}. `
  }

  // If only one backend is readable, use that one.
  if (sqliteTime === 0 && yamlTime > 0) {
    const repo = new YamlGraphRepository(projectDir)
    const reason = `SQLite unreadable${parseError ? ` (${parseError.trim()})` : ""}; using YAML.`
    writeSentinel(projectDir, "yaml")
    sddDebug("repository", `[conflict-resolve] ${reason}`)
    return { repo, winner: "yaml", reason }
  }
  if (yamlTime === 0 && sqliteTime > 0) {
    const repo = new SqliteGraphRepository(projectDir)
    const reason = `YAML unreadable${parseError ? ` (${parseError.trim()})` : ""}; using SQLite.`
    writeSentinel(projectDir, "sqlite")
    sddDebug("repository", `[conflict-resolve] ${reason}`)
    return { repo, winner: "sqlite", reason }
  }

  // Both readable — compare updated_at.
  if (sqliteTime > yamlTime) {
    const repo = new SqliteGraphRepository(projectDir)
    const reason =
      `SQLite is more recent (sqlite updated_at=${new Date(sqliteTime).toISOString()}, ` +
      `yaml updated_at=${new Date(yamlTime).toISOString()}). Using SQLite.`
    writeSentinel(projectDir, "sqlite")
    sddDebug("repository", `[conflict-resolve] ${reason}`)
    return { repo, winner: "sqlite", reason }
  }

  if (yamlTime > sqliteTime) {
    const repo = new YamlGraphRepository(projectDir)
    const reason =
      `YAML is more recent (yaml updated_at=${new Date(yamlTime).toISOString()}, ` +
      `sqlite updated_at=${new Date(sqliteTime).toISOString()}). Using YAML.`
    writeSentinel(projectDir, "yaml")
    sddDebug("repository", `[conflict-resolve] ${reason}`)
    return { repo, winner: "yaml", reason }
  }

  // Timestamps equal — SQLite wins by policy (migration was intentional).
  const repo = new SqliteGraphRepository(projectDir)
  const reason =
    `Timestamps equal (${new Date(sqliteTime).toISOString()}). ` +
    `SQLite wins by policy: migration is intentional and SQLite is always canonical ` +
    `once created. (sqlite nodes=${sqliteNodeCount}, yaml nodes=${yamlNodeCount})`
  writeSentinel(projectDir, "sqlite")
  sddDebug("repository", `[conflict-resolve] ${reason}`)
  return { repo, winner: "sqlite", reason }
}

/** Module-level cache of the last conflict-resolution result for check_migrations reporting. */
let lastConflictResolution: { winner: "yaml" | "sqlite"; reason: string } | null = null

/** Returns the last conflict resolution performed in this process (for sdd.check_migrations). */
export function getLastConflictResolution(): { winner: "yaml" | "sqlite"; reason: string } | null {
  return lastConflictResolution
}

/**
 * Auto-detect the best storage backend and return a repository.
 *
 * Decision priority:
 * 1. Sentinel file (.sdd/storage-backend) — authoritative explicit choice.
 *    Auto-healed on first call: if graph.db exists without a sentinel, the
 *    sentinel is written as "sqlite" immediately (Opção B).
 * 2. Both graph.yaml and graph.db exist without sentinel →
 *    resolveConflictingBackends() — intelligent analysis with SQLite preference.
 * 3. Only graph.db exists → SQLite (+ auto-heal sentinel).
 * 4. Only graph.yaml exists, < 1000 nodes → YAML.
 * 5. Only graph.yaml exists, ≥ 1000 nodes → auto-migrate to SQLite.
 * 6. Neither exists → YAML (default for new projects).
 *
 * .bak / .bk / .backup files are NEVER opened as active graphs — they are
 * read-only disaster-recovery archives.
 */
export function createRepository(projectDir: string): GraphRepository {
  const sddDir = join(projectDir, ".sdd")
  const yamlPath = join(sddDir, "graph.yaml")
  const dbPath = join(sddDir, "graph.db")

  // Safety: these paths must never be backup files.
  assertNotBackup(yamlPath)
  assertNotBackup(dbPath)

  // ── 1. Sentinel-first decision ──────────────────────────────────────────
  const sentinel = readSentinel(projectDir)
  if (sentinel) {
    if (sentinel === "sqlite") {
      if (existsSync(dbPath)) {
        const { SqliteGraphRepository } = require("./sqlite.js")
        return new SqliteGraphRepository(projectDir)
      }
      // Sentinel says sqlite but db is missing — corrupted state; fall through.
      sddDebug("repository", "Sentinel says sqlite but graph.db is missing — falling back to file detection")
    } else {
      if (existsSync(yamlPath)) {
        const { YamlGraphRepository } = require("./yaml.js")
        return new YamlGraphRepository(projectDir)
      }
      sddDebug("repository", "Sentinel says yaml but graph.yaml is missing — falling back to file detection")
    }
  }

  // ── 2. Both backends exist without sentinel — intelligent resolution ─────
  if (existsSync(dbPath) && existsSync(yamlPath)) {
    const resolution = resolveConflictingBackends(projectDir, yamlPath, dbPath)
    lastConflictResolution = { winner: resolution.winner, reason: resolution.reason }
    return resolution.repo
  }

  // ── 3. Auto-heal: only graph.db exists without sentinel ─────────────────
  if (existsSync(dbPath)) {
    try {
      writeSentinel(projectDir, "sqlite")
      sddDebug("repository", "Auto-healed: wrote sentinel sqlite for existing graph.db")
    } catch (e) {
      sddDebug("repository", `Auto-heal sentinel write failed: ${e}`)
    }
    const { SqliteGraphRepository } = require("./sqlite.js")
    return new SqliteGraphRepository(projectDir)
  }

  // ── 4. Only YAML exists ──────────────────────────────────────────────────
  if (existsSync(yamlPath)) {
    const nodeCount = countNodesInYaml(yamlPath)
    if (nodeCount >= MIGRATION_THRESHOLD) {
      return autoMigrateToSqlite(projectDir)
    }
    if (!sentinel) {
      try {
        writeSentinel(projectDir, "yaml")
      } catch (e) {
        sddDebug("repository", `Sentinel write failed for yaml project: ${e}`)
      }
    }
    const { YamlGraphRepository } = require("./yaml.js")
    return new YamlGraphRepository(projectDir)
  }

  // ── 5. Default: YAML for new projects ───────────────────────────────────
  const { YamlGraphRepository } = require("./yaml.js")
  return new YamlGraphRepository(projectDir)
}

/**
 * Quick node count from YAML without full parse.
 * Reads the file and counts node entries approximately.
 */
function countNodesInYaml(yamlPath: string): number {
  try {
    const content = readFileSync(yamlPath, "utf-8")
    const parsed = require("js-yaml").load(content) as { nodes?: unknown[] }
    return Array.isArray(parsed?.nodes) ? parsed.nodes.length : 0
  } catch {
    return 0
  }
}

/**
 * Auto-migrate from YAML to SQLite.
 *
 * Steps (all-or-nothing from the caller's perspective):
 * 1. Load graph from YAML.
 * 2. Write graph to SQLite.
 * 3. Rename graph.yaml → graph.yaml.bak (atomic on POSIX; near-atomic on Windows).
 *    After this rename, createRepository will never see both files coexisting.
 * 4. Write the sentinel so the decision is explicit on every future call.
 */
function autoMigrateToSqlite(projectDir: string): GraphRepository {
  const { YamlGraphRepository } = require("./yaml.js")
  const { SqliteGraphRepository } = require("./sqlite.js")

  const sddDir = join(projectDir, ".sdd")
  const yamlOrigPath = join(sddDir, "graph.yaml")
  const yamlBakPath = join(sddDir, "graph.yaml.bak")

  const yamlRepo = new YamlGraphRepository(projectDir)
  const graph = yamlRepo.loadGraph()

  const sqliteRepo = new SqliteGraphRepository(projectDir)
  sqliteRepo.saveGraph(graph)

  // Rename the original YAML to .bak — atomic on POSIX, so createRepository
  // will never observe both graph.yaml and graph.db simultaneously.
  try {
    renameSync(yamlOrigPath, yamlBakPath)
  } catch (error) {
    // If rename fails (e.g. cross-device), fall back to write-then-delete.
    try {
      const yaml = require("js-yaml")
      const { atomicWriteFile } = require("../cache/atomic.js")
      atomicWriteFile(yamlBakPath, yaml.dump(graph, { noRefs: true, lineWidth: 120 }))
      const { unlinkSync } = require("fs")
      unlinkSync(yamlOrigPath)
    } catch (fallbackError) {
      throw new Error(
        `Could not create YAML migration backup: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
      )
    }
  }

  // Write the sentinel so every future createRepository call skips inference.
  writeSentinel(projectDir, "sqlite")

  return sqliteRepo
}

/**
 * Load the SDD configuration, falling back to defaults.
 */
export function loadSddConfig(projectDir: string): SddConfig {
  const configPath = join(projectDir, ".sdd", "config.json")
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8")
      const parsed = JSON.parse(content) as Partial<SddConfig>
      return {
        ...DEFAULT_SDD_CONFIG,
        ...parsed,
        dashboard: { ...DEFAULT_SDD_CONFIG.dashboard, ...(parsed.dashboard || {}) },
        workflow: { ...DEFAULT_SDD_CONFIG.workflow, ...(parsed.workflow || {}) },
        graph: { ...DEFAULT_SDD_CONFIG.graph, ...(parsed.graph || {}) },
        git: { ...DEFAULT_SDD_CONFIG.git, ...(parsed.git || {}) },
        validation: { ...DEFAULT_SDD_CONFIG.validation, ...(parsed.validation || {}) },
        acceptance: { ...DEFAULT_SDD_CONFIG.acceptance, ...(parsed.acceptance || {}) },
      }
    } catch (error) { sddDebug("repository", "Failed to load SDD config, using defaults") }
  }
  return DEFAULT_SDD_CONFIG
}
