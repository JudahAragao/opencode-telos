/**
 * Local lexical relevance between the user's input and the routing options.
 *
 * Routing uses BM25: deterministic, offline, and preserving technical terms,
 * file names and command names.
 *
 * Consumido por: intent-classifier.ts
 * Dependencies: none (pure module)
 */

/**
 * Computes the BM25 relevance between a query and multiple options.
 * Returns (label, score) pairs ordered by descending relevance.
 *
 * Scores are unbounded — normalize against the best match when you need
 * a confidence value comparable across queries.
 */
export function rankSimilarity(
  query: string,
  options: Array<{ label: string; text: string }>,
): Array<{ label: string; score: number }> {
  const tokenize = (text: string) => text.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_./-]+/).filter((term) => term.length > 1)
  const terms = tokenize(query)
  const documents = options.map((option) => tokenize(option.text))
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / Math.max(documents.length, 1)
  const documentFrequency = new Map<string, number>()
  for (const document of documents) {
    for (const term of new Set(document)) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1)
  }
  return options.map((option, index) => {
    const document = documents[index]
    const frequencies = new Map<string, number>()
    for (const term of document) frequencies.set(term, (frequencies.get(term) || 0) + 1)
    const score = [...new Set(terms)].reduce((total, term) => {
      const frequency = frequencies.get(term) || 0
      if (!frequency) return total
      const idf = Math.log(1 + (options.length - (documentFrequency.get(term) || 0) + 0.5) / ((documentFrequency.get(term) || 0) + 0.5))
      const k1 = 1.2
      const b = 0.75
      return total + idf * (frequency * (k1 + 1)) / (frequency + k1 * (1 - b + b * document.length / Math.max(averageLength, 1)))
    }, 0)
    return { label: option.label, score }
  }).sort((a, b) => b.score - a.score)
}
