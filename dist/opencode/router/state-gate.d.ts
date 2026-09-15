/**
 * State Gate — Determina quais tools são visíveis para cada estado do grafo.
 *
 * Reduz o espaço de escolha do LLM mostrando apenas tools relevantes.
 * Fallback: se o resultado for vazio, mostra todas as tools.
 *
 * Consumido por: hooks.ts (experimental.chat.system.transform)
 * Dependências: graph-state-snapshot.ts, tool-taxonomy.ts
 */
/**
 * Obtém as tools visíveis para o estado atual do grafo.
 *
 * @param directory - Diretório do projeto
 * @returns Set de nomes de tools visíveis. Se vazio (fallback), retorna null para indicar "todas".
 */
export declare function getVisibleTools(directory: string): Set<string> | null;
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
 * Escape hatch: instrução para o LLM mostrar todas as tools se necessário.
 */
export declare const ESCAPE_HATCH_INSTRUCTION: string;
