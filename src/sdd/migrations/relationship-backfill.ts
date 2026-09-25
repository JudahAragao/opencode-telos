/**
 * Migration: traceability rebuild on existing graphs.
 *
 * Earlier plugins created spec/code/task nodes but left semantic edges
 * incomplete (endpoint→feature, file→feature, endpoint→entity,
 * requirement→feature, task→milestone). This migration runs the inference
 * engine over the existing graph, normalizes inverse pairs
 * (`satisfied_by` → `specifies`, `implemented_by` → `implements`, etc.) e
 * and creates the milestone nodes.
 *
 * It is idempotent: rerunning does not duplicate edges. It works equally for
 * YAML and SQLite projects, because it operates on the loaded `KnowledgeGraph`.
 */

import { registerMigration } from "./migration-runner.js"
import { existsSync } from "fs"
import { join } from "path"

registerMigration({
  id: "20260922_backfill_relationship_traceability",
  description:
    "Rebuilds the graph traceability (edge inference, inverses and milestones)",
  version: "1.6.0",
  up: (projectDir: string) => {
    const yamlPath = join(projectDir, ".sdd", "graph.yaml")
    const dbPath = join(projectDir, ".sdd", "graph.db")
    if (!existsSync(yamlPath) && !existsSync(dbPath)) {        return { success: true, message: "No graph found, nothing to do" }
    }

    try {
      const { createRepository } = require("../persistence/repository.js")
      const { runRelationshipInference } = require("../discovery/relationship-inferencer.js")

      const repo = createRepository(projectDir)
      if (!repo.isInitialized()) {
        return { success: false, message: "SDD not initialized" }
      }

      const graph = repo.loadGraph()
      const before = graph.relationships.length
      const result = runRelationshipInference(graph)
      const added = graph.relationships.length - before

      if (added === 0 && result.normalized === 0 && result.milestones_created === 0) {
        return { success: true, message: "Traceability was already complete" }
      }

      repo.saveGraph(graph)

      const modified: string[] = []
      if (existsSync(dbPath)) modified.push(dbPath)
      if (existsSync(yamlPath)) modified.push(yamlPath)

      return {
        success: true,
        message:
          `Traceability rebuilt: ${added} edge(s) added, ` +
          `${result.normalized} inverso(s) normalizado(s), ` +
          `${result.milestones_created} milestone(s) criado(s)`,
        files_modified: modified,
      }
    } catch (err) {
      return {
        success: false,
        message:          `Traceability backfill failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
})

export function registerRelationshipBackfill(): void {}
