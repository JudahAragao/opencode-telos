import { registerMigration } from "./migration-runner.js"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { atomicWriteFile } from "../cache/atomic.js"

// ── Migration 1: Sync graph.db from graph.yaml ──
registerMigration({
  id: "20260825_sync_graph_db_from_yaml",
  description: "Rebuild graph.db from graph.yaml to ensure fresh data",
  version: "1.0.0",
  up: (projectDir: string) => {
    const yamlPath = join(projectDir, ".sdd", "graph.yaml")
    const dbPath = join(projectDir, ".sdd", "graph.db")
    
    if (!existsSync(yamlPath)) {
      return { success: true, message: "No graph.yaml found, skipping" }
    }
    
    if (existsSync(dbPath)) {
      const yamlStat = require("fs").statSync(yamlPath)
      const dbStat = require("fs").statSync(dbPath)
      if (dbStat.mtimeMs >= yamlStat.mtimeMs) {
        return { success: true, message: "graph.db is already up to date" }
      }
    }
    
    try {
      const { createRepository } = require("../../sdd/persistence/repository.js")
      const { SqliteGraphRepository } = require("../../sdd/persistence/sqlite.js")
      
      const yamlRepo = createRepository(projectDir)
      if (!yamlRepo.isInitialized()) return { success: false, message: "SDD not initialized" }
      const graph = yamlRepo.loadGraph()
      
      const sqliteRepo = new SqliteGraphRepository(projectDir)
      sqliteRepo.saveGraph(graph)
      
      return {
        success: true,
        message: `Synced graph.db from graph.yaml (${graph.nodes.length} nodes)`,
        files_modified: [dbPath],
      }
    } catch (err) {
      return { success: false, message: `Failed to sync: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
})

// ── Migration 2: Add missing priority fields ──
registerMigration({
  id: "20260825_add_missing_priority",
  description: "Add default priority to nodes missing it",
  version: "1.0.0",
  up: (projectDir: string) => {
    const yamlPath = join(projectDir, ".sdd", "graph.yaml")
    if (!existsSync(yamlPath)) return { success: true, message: "No graph.yaml" }
    
    try {
      const { createRepository } = require("../../sdd/persistence/repository.js")
      const repo = createRepository(projectDir)
      if (!repo.isInitialized()) return { success: false, message: "SDD not initialized" }
      const graph = repo.loadGraph()
      
      let modified = false
      for (const node of graph.nodes) {
        if (node.type === "test" || node.type === "requirement") {
          const meta = node.metadata as Record<string, unknown>
          if (!meta.priority) {
            meta.priority = "normal"
            modified = true
          }
        }
      }
      
      if (!modified) return { success: true, message: "All nodes already have priority" }
      repo.saveGraph(graph)
      return { success: true, message: "Added default priority", files_modified: [yamlPath] }
    } catch (err) {
      return { success: false, message: `Failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
})

// ── Migration 3: Validate drift whitelist ──
registerMigration({
  id: "20260825_validate_drift_whitelist",
  description: "Validate and normalize drift whitelist",
  version: "1.0.0",
  up: (projectDir: string) => {
    const whitelistPath = join(projectDir, ".sdd", "drift-whitelist.json")
    if (!existsSync(whitelistPath)) return { success: true, message: "No whitelist found" }
    
    try {
      const whitelist = JSON.parse(readFileSync(whitelistPath, "utf-8"))
      
      if (!whitelist.entries || !Array.isArray(whitelist.entries)) {
        atomicWriteFile(whitelistPath, JSON.stringify({ version: 1, entries: [] }, null, 2))
        return { success: true, message: "Rebuilt corrupted whitelist" }
      }
      
      let modified = false
      for (const entry of whitelist.entries) {
        const normalized = entry.file_path.replace(/^\.\//, "")
        if (normalized !== entry.file_path) {
          entry.file_path = normalized
          modified = true
        }
      }
      
      if (modified) {
        atomicWriteFile(whitelistPath, JSON.stringify(whitelist, null, 2))
        return { success: true, message: "Normalized paths" }
      }
      return { success: true, message: "Whitelist is valid" }
    } catch {
      atomicWriteFile(whitelistPath, JSON.stringify({ version: 1, entries: [] }, null, 2))
      return { success: true, message: "Rebuilt corrupted whitelist" }
    }
  },
})

// ── Migration 4: Validate graph structure ──
registerMigration({
  id: "20260825_validate_graph_structure",
  description: "Validate and fix graph structure",
  version: "1.0.0",
  up: (projectDir: string) => {
    const yamlPath = join(projectDir, ".sdd", "graph.yaml")
    if (!existsSync(yamlPath)) return { success: true, message: "No graph.yaml" }
    
    try {
      const { createRepository } = require("../../sdd/persistence/repository.js")
      const repo = createRepository(projectDir)
      if (!repo.isInitialized()) return { success: false, message: "SDD not initialized" }
      const graph = repo.loadGraph()
      
      let fixed = 0
      for (const node of graph.nodes) {
        if (!node.id) continue
        if (!node.type) { node.type = "unknown"; fixed++ }
        if (!node.name) { node.name = node.id; fixed++ }
        if (!node.status) { node.status = "DRAFT"; fixed++ }
        if (!node.metadata) { node.metadata = {}; fixed++ }
      }
      
      if (fixed === 0) return { success: true, message: "Graph structure is valid" }
      repo.saveGraph(graph)
      return { success: true, message: `Fixed ${fixed} issues`, files_modified: [yamlPath] }
    } catch (err) {
      return { success: false, message: `Failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
})

export function getFixes(): void {}
