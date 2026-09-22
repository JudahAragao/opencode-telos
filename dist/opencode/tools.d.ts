import { type ToolDefinition } from "@opencode-ai/plugin";
/** Call after any operation that changes the active storage backend. */
export declare function invalidateCachedRepo(directory: string): void;
/**
 * Invalidate cache for specific node types after a mutation.
 */
export declare function invalidateCacheForMutation(directory: string, nodeTypes: string[], relTypes?: string[]): void;
export declare const invalidateCache: typeof invalidateCacheForMutation;
/**
 * Definições COMPLETAS de tools (canônicas + depreciadas).
 *
 * Não é a superfície pública: `createSddTools()` filtra as depreciadas. Este
 * mapa existe para que os composites executem os handlers originais de cada
 * sub-action (`sdd.add_node`, `sdd.verify_usage`, ...) sem manter os nomes
 * antigos anunciados ao modelo.
 */
export declare function createSddToolDefinitions(): Record<string, ToolDefinition>;
/**
 * Catálogo PÚBLICO de tools: exatamente o que é registrado no runtime e
 * anunciado ao LLM.
 *
 * Exclui as tools depreciadas — toda capacidade que já é oferecida por uma
 * tool composta (`sdd.{composite}(action=...)`). Os handlers continuam
 * disponíveis internamente via `createSddToolDefinitions()`, mas apenas um
 * nome por capacidade chega ao modelo. Anunciar dois caminhos para a mesma
 * ação (ex.: `sdd.add_node` e `sdd.graph_mutation(action="add_node")`) é o que
 * fazia o LLM se perder.
 */
export declare function createSddTools(): Record<string, ToolDefinition>;
