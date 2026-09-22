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
export declare function registerRelationshipBackfill(): void;
