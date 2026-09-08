/**
 * Similaridade local entre input do usuário e tools SDD.
 *
 * O roteamento usa BM25 lexical. O vetor hash-based permanece apenas como
 * compatibilidade para consumidores externos.
 *
 * Consumido por: intent-classifier.ts, semantic-nudge.ts
 * Dependências: nenhuma (módulo puro)
 */
/** Fixed dimension for the deterministic lexical vector. It is not an ML embedding. */
const LEXICAL_VECTOR_DIM = 384;
/**
 * Gera um vetor lexical determinístico a partir de uma string usando hashes.
 */
function hashToLexicalVector(text) {
    const vector = new Array(LEXICAL_VECTOR_DIM);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
    const words = normalized.split(/\s+/).filter(w => w.length > 1);
    // Inicializar com zeros
    for (let i = 0; i < LEXICAL_VECTOR_DIM; i++) {
        vector[i] = 0;
    }
    // Adicionar contribuição de cada palavra
    for (const word of words) {
        let hash = 0;
        for (let i = 0; i < word.length; i++) {
            hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
        }
        // Espalhar a contribuição da palavra pelo vetor
        const seed = Math.abs(hash);
        for (let i = 0; i < LEXICAL_VECTOR_DIM; i++) {
            const val = Math.sin(seed * (i + 1) * 0.001) * 0.1;
            vector[i] += val;
        }
    }
    // Normalizar
    let norm = 0;
    for (let i = 0; i < LEXICAL_VECTOR_DIM; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < LEXICAL_VECTOR_DIM; i++) {
            vector[i] /= norm;
        }
    }
    return vector;
}
/**
 * Calcula similaridade coseno entre dois vetores.
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
}
/**
 * Cache de vetores lexicais calculados.
 */
const embeddingCache = new Map();
/**
 * Obtém o vetor lexical para uma string (com cache).
 */
export function getLexicalVector(text) {
    const cached = embeddingCache.get(text);
    if (cached)
        return cached;
    const vector = hashToLexicalVector(text);
    embeddingCache.set(text, vector);
    return vector;
}
/** @deprecated Use getLexicalVector; this compatibility alias is not an ML embedding. */
export const getEmbedding = getLexicalVector;
/**
 * Calcula similaridade entre um texto e múltiplas opções.
 * Retorna pares (label, score) ordenados por similaridade decrescente.
 */
export function rankSimilarity(query, options) {
    // Tool routing needs dependable lexical relevance, not an untrained hash
    // vector that merely looks semantic. BM25 is local, deterministic and
    // preserves exact technical terms, filenames and command names.
    const tokenize = (text) => text.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9_./-]+/).filter((term) => term.length > 1);
    const terms = tokenize(query);
    const documents = options.map((option) => tokenize(option.text));
    const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / Math.max(documents.length, 1);
    const documentFrequency = new Map();
    for (const document of documents) {
        for (const term of new Set(document))
            documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
    return options.map((option, index) => {
        const document = documents[index];
        const frequencies = new Map();
        for (const term of document)
            frequencies.set(term, (frequencies.get(term) || 0) + 1);
        const score = [...new Set(terms)].reduce((total, term) => {
            const frequency = frequencies.get(term) || 0;
            if (!frequency)
                return total;
            const idf = Math.log(1 + (options.length - (documentFrequency.get(term) || 0) + 0.5) / ((documentFrequency.get(term) || 0) + 0.5));
            const k1 = 1.2;
            const b = 0.75;
            return total + idf * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * document.length / Math.max(averageLength, 1)));
        }, 0);
        return { label: option.label, score };
    }).sort((a, b) => b.score - a.score);
}
/**
 * Limpa o cache de vetores lexicais.
 */
export function clearEmbeddingCache() {
    embeddingCache.clear();
}
/**
 * Gera vetores lexicais para todas as tools e retorna o mapa.
 * Útil para pré-computação e persistência.
 */
export function generateToolEmbeddings(tools) {
    const map = new Map();
    for (const tool of tools) {
        map.set(tool.name, getLexicalVector(tool.description));
    }
    return map;
}
