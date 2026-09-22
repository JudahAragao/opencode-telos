/**
 * Motor de inferência de relacionamentos.
 *
 * Reconstrói a rastreabilidade do grafo de forma determinística e idempotente,
 * cobrindo as lacunas que a construção por regex/keyword deixava:
 *   - requirement  --specifies-->  feature
 *   - endpoint     --implements--> feature
 *   - file/module  --implements--> feature
 *   - endpoint     --operates_on--> entity
 *   - task         --implements--> requirement/feature
 *   - task/change  --belongs_to--> milestone
 *
 * Toda aresta inferida carrega `metadata` com `inferred`, `method`,
 * `confidence` e `evidence`, então pode ser auditada e substituída por uma
 * decisão explícita. O motor é conservador: só materializa a melhor
 * correspondência acima do limiar de confiança e nunca cria ciclo, self-loop
 * ou par inverso redundante.
 */
import type { KnowledgeGraph, RelationshipType } from "../domain/types.js";
export type InferenceMethod = "explicit-metadata" | "handler-match" | "path-match" | "name-match" | "field-match" | "weak-fallback";
export interface InferenceProposal {
    from: string;
    to: string;
    type: RelationshipType;
    confidence: number;
    method: InferenceMethod;
    evidence?: string;
}
export interface InferenceOptions {
    /** Confiança mínima para materializar uma aresta (default: 0.5). */
    minConfidence?: number;
    /** Criar/ligar milestones a partir de `metadata.milestone` (default: true). */
    includeMilestones?: boolean;
    /** Normalizar pares inversos antes de inferir (default: true). */
    normalizeInverses?: boolean;
    /** Máximo de alvos por (nó, tipo) nas heurísticas de nome/caminho (default: 2). */
    maxTargetsPerType?: number;
}
export interface InferenceResult {
    proposals: number;
    applied: number;
    skipped: number;
    normalized: number;
    milestones_created: number;
    by_type: Record<string, number>;
}
/**
 * Garante que todo `metadata.milestone` (string) declarado em change/task
 * exista como nó `milestone` e esteja ligado por `belongs_to`.
 */
export declare function ensureMilestoneNodes(graph: KnowledgeGraph): number;
/**
 * Calcula as arestas que faltam no grafo, sem mutá-lo.
 */
export declare function inferRelationships(graph: KnowledgeGraph, options?: InferenceOptions): InferenceProposal[];
/**
 * Materializa as propostas no grafo. Idempotente: reexecutar não duplica
 * arestas e respeita a matriz canônica e o bloqueio de ciclos.
 */
export declare function applyInferredRelationships(graph: KnowledgeGraph, proposals: InferenceProposal[]): {
    applied: number;
    skipped: number;
    byType: Record<string, number>;
};
/**
 * Remove pares inversos redundantes, mantendo o tipo preferido
 * (ex.: mantém `specifies` e remove `satisfied_by`).
 */
export declare function normalizeInverseRelationships(graph: KnowledgeGraph): number;
/**
 * Fluxo completo usado por tools, builders e migrações:
 * normaliza inversos, garante milestones e materializa as arestas inferidas.
 */
export declare function runRelationshipInference(graph: KnowledgeGraph, options?: InferenceOptions): InferenceResult;
