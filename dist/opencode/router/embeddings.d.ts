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
export declare function rankSimilarity(query: string, options: Array<{
    label: string;
    text: string;
}>): Array<{
    label: string;
    score: number;
}>;
