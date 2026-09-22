/**
 * Migração: reconstrução de rastreabilidade em grafos existentes.
 *
 * Plugins anteriores criavam nós de spec/código/task, mas deixavam as arestas
 * semânticas incompletas (endpoint→feature, file→feature, endpoint→entity,
 * requirement→feature, task→milestone). Esta migração roda o motor de
 * inferência sobre o grafo já existente, normaliza pares inversos
 * (`satisfied_by` → `specifies`, `implemented_by` → `implements`, etc.) e
 * garante os nós de milestone.
 *
 * É idempotente: reexecutar não duplica arestas. Funciona igualmente para
 * projetos YAML e SQLite, porque opera sobre o `KnowledgeGraph` carregado.
 */
import { registerMigration } from "./migration-runner.js";
import { existsSync } from "fs";
import { join } from "path";
registerMigration({
    id: "20260922_backfill_relationship_traceability",
    description: "Reconstrói a rastreabilidade do grafo (inferência de arestas, inversos e milestones)",
    version: "1.6.0",
    up: (projectDir) => {
        const yamlPath = join(projectDir, ".sdd", "graph.yaml");
        const dbPath = join(projectDir, ".sdd", "graph.db");
        if (!existsSync(yamlPath) && !existsSync(dbPath)) {
            return { success: true, message: "Nenhum grafo encontrado, nada a fazer" };
        }
        try {
            const { createRepository } = require("../persistence/repository.js");
            const { runRelationshipInference } = require("../discovery/relationship-inferencer.js");
            const repo = createRepository(projectDir);
            if (!repo.isInitialized()) {
                return { success: false, message: "SDD não inicializado" };
            }
            const graph = repo.loadGraph();
            const before = graph.relationships.length;
            const result = runRelationshipInference(graph);
            const added = graph.relationships.length - before;
            if (added === 0 && result.normalized === 0 && result.milestones_created === 0) {
                return { success: true, message: "Rastreabilidade já estava completa" };
            }
            repo.saveGraph(graph);
            const modified = [];
            if (existsSync(dbPath))
                modified.push(dbPath);
            if (existsSync(yamlPath))
                modified.push(yamlPath);
            return {
                success: true,
                message: `Rastreabilidade reconstruída: ${added} aresta(s) adicionada(s), ` +
                    `${result.normalized} inverso(s) normalizado(s), ` +
                    `${result.milestones_created} milestone(s) criado(s)`,
                files_modified: modified,
            };
        }
        catch (err) {
            return {
                success: false,
                message: `Falha no backfill de rastreabilidade: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    },
});
export function registerRelationshipBackfill() { }
