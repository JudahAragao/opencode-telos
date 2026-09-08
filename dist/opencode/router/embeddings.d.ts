/**
 * Similaridade local entre input do usuário e tools SDD.
 *
 * O roteamento usa BM25 lexical. O vetor hash-based permanece apenas como
 * compatibilidade para consumidores externos.
 *
 * Consumido por: intent-classifier.ts, semantic-nudge.ts
 * Dependências: nenhuma (módulo puro)
 */
/**
 * Calcula similaridade coseno entre dois vetores.
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
/**
 * Obtém o vetor lexical para uma string (com cache).
 */
export declare function getLexicalVector(text: string): number[];
/** @deprecated Use getLexicalVector; this compatibility alias is not an ML embedding. */
export declare const getEmbedding: typeof getLexicalVector;
/**
 * Calcula similaridade entre um texto e múltiplas opções.
 * Retorna pares (label, score) ordenados por similaridade decrescente.
 */
export declare function rankSimilarity(query: string, options: Array<{
    label: string;
    text: string;
}>): Array<{
    label: string;
    score: number;
}>;
/**
 * Limpa o cache de vetores lexicais.
 */
export declare function clearEmbeddingCache(): void;
/**
 * Gera vetores lexicais para todas as tools e retorna o mapa.
 * Útil para pré-computação e persistência.
 */
export declare function generateToolEmbeddings(tools: Array<{
    name: string;
    description: string;
}>): Map<string, number[]>;
