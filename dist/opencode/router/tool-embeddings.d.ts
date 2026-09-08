/**
 * Tool catalog — Descriptions cacheadas para todas as tools SDD.
 *
 * Mantém o catálogo usado pelo roteamento lexical. Os vetores são hash-based,
 * não embeddings semânticos de um modelo.
 *
 * Consumido por: semantic-nudge.ts
 * Dependências: embeddings.ts, tool-taxonomy.ts
 */
export interface ToolEmbedding {
    name: string;
    description: string;
    vector: number[];
    category: string;
}
/**
 * Gera embeddings para todas as tools (standalone + composite).
 */
export declare function generateAllToolEmbeddings(): ToolEmbedding[];
/**
 * Obtém embeddings com cache.
 */
export declare function getCachedToolEmbeddings(): ToolEmbedding[];
/**
 * Força regeneração do cache.
 */
export declare function refreshToolEmbeddings(): ToolEmbedding[];
/**
 * Serializa embeddings para JSON (para persistência).
 */
export declare function serializeEmbeddings(embeddings: ToolEmbedding[]): string;
/**
 * Desserializa embeddings de JSON.
 */
export declare function deserializeEmbeddings(json: string): ToolEmbedding[];
