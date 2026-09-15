/**
 * Relevância lexical local entre o input do usuário e as opções de roteamento.
 *
 * O roteamento usa BM25: determinístico, sem rede e preservando termos
 * técnicos, nomes de arquivo e nomes de comando.
 *
 * Consumido por: intent-classifier.ts
 * Dependências: nenhuma (módulo puro)
 */
/**
 * Calcula a relevância BM25 entre uma consulta e múltiplas opções.
 * Retorna pares (label, score) ordenados por relevância decrescente.
 *
 * Os scores são ilimitados — normalize contra o melhor match quando precisar
 * de um valor de confiança comparável entre consultas.
 */
export function rankSimilarity(query, options) {
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
