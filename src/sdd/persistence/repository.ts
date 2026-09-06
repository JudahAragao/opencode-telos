import type { KnowledgeGraph, AnyNode, NodeType, NodeStatus, Relationship } from "../domain/types.js"
import { DEFAULT_SDD_CONFIG, type SddConfig } from "../domain/types.js"
import { GraphIndices } from "../graph/index.js"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

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
  createProject(projectId: string, name: string, description?: string): KnowledgeGraph

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

/**
 * Auto-detect the best storage backend and return a repository.
 *
 * Decision logic:
 * - If .sdd/graph.db exists → use SQLite
 * - If .sdd/graph.yaml exists and <1000 nodes → use YAML
 * - If .sdd/graph.yaml exists and ≥1000 nodes → auto-migrate to SQLite
 * - If neither exists → return YAML (default for new projects)
 */
export function createRepository(projectDir: string): GraphRepository {
  const sddDir = join(projectDir, ".sdd")
  const yamlPath = join(sddDir, "graph.yaml")
  const dbPath = join(sddDir, "graph.db")

  // If SQLite already exists, use it
  if (existsSync(dbPath)) {
    const { SqliteGraphRepository } = require("./sqlite.js")
    return new SqliteGraphRepository(projectDir)
  }

  // If YAML exists, check if migration is needed
  if (existsSync(yamlPath)) {
    const nodeCount = countNodesInYaml(yamlPath)
    if (nodeCount >= MIGRATION_THRESHOLD) {
      // Auto-migrate to SQLite
      return autoMigrateToSqlite(projectDir)
    }
    const { YamlGraphRepository } = require("./yaml.js")
    return new YamlGraphRepository(projectDir)
  }

  // Default: YAML for new projects
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
    // Count "- id:" occurrences which indicates node entries
    const matches = content.match(/^  - id:/gm)
    return matches ? matches.length : 0
  } catch {
    return 0
  }
}

/**
 * Auto-migrate from YAML to SQLite.
 * Reads the YAML graph, writes to SQLite, returns SQLite repository.
 */
function autoMigrateToSqlite(projectDir: string): GraphRepository {
  const { YamlGraphRepository } = require("./yaml.js")
  const { SqliteGraphRepository } = require("./sqlite.js")

  const yamlRepo = new YamlGraphRepository(projectDir)
  const graph = yamlRepo.loadGraph()

  const sqliteRepo = new SqliteGraphRepository(projectDir)
  sqliteRepo.saveGraph(graph)

  // Keep YAML as backup
  const yamlPath = join(projectDir, ".sdd", "graph.yaml.bak")
  try {
    const { writeFileSync } = require("fs")
    const yaml = require("js-yaml")
    writeFileSync(yamlPath, yaml.dump(graph, { noRefs: true, lineWidth: 120 }))
  } catch {}

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
      }
    } catch {}
  }
  return DEFAULT_SDD_CONFIG
}
