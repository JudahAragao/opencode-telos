/**
 * State Gate — Prioriza as tools mais relevantes para cada estado do grafo.
 *
 * ATENÇÃO: este módulo NÃO esconde tools. O catálogo completo é sempre
 * anunciado ao agente por tool-registry.ts; aqui só calculamos o subconjunto
 * que merece destaque para o estado atual. A decisão final de o que pode ser
 * chamado é da política de enforcement (checkToolAccess).
 *
 * Esconder tools por categoria foi a causa de entry points essenciais
 * (sdd.start_dashboard, sdd.enforce, ...) nunca chegarem ao prompt.
 *
 * Consumido por: tool-registry.ts
 * Dependências: graph-state-snapshot.ts, tool-taxonomy.ts
 */
/**
 * Obtém as tools recomendadas (destaques) para o estado atual do grafo.
 *
 * @param directory - Diretório do projeto
 * @returns Set de nomes de tools recomendadas. Nunca indica "ocultar".
 */
export declare function getRecommendedTools(directory: string): Set<string>;
/** @deprecated Use getRecommendedTools — nenhuma tool é ocultada do agente. */
export declare const getVisibleTools: typeof getRecommendedTools;
/**
 * Formata a lista de tools visíveis para injeção no system prompt.
 */
export declare function formatVisibleTools(visibleTools: Set<string> | null): string;
/**
 * Contrato de enforcement anunciado junto com a lista de tools.
 *
 * Mantém o prompt coerente com a política aplicada por checkToolAccess: as
 * tools de mutação são recusadas enquanto não houver um Change ativo, então a
 * ordem de bootstrap precisa estar explícita para o agente.
 */
export declare const ENFORCEMENT_ORDER_INSTRUCTION: string;
/**
 * Como escolher a tool: a lista anunciada é o catálogo completo, então a
 * instrução passa a ser de priorização, não de descoberta.
 */
export declare const ESCAPE_HATCH_INSTRUCTION: string;
