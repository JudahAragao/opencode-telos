/**
 * Tool Taxonomy — Mapeamento hierárquico de tools do SDD.
 *
 * Cada tool composta agrupa capacidades relacionadas por domínio.
 * O LLM chama: `sdd.{composite}(action="sub_action")`
 *
 * Base para: router (intent classification), state gate, e system prompt.
 */
export type ToolCategory = "graph" | "workflow" | "analysis" | "quality" | "sync" | "enterprise" | "admin";
export interface SubAction {
    name: string;
    description: string;
}
export interface CompositeTool {
    name: string;
    /** Nome curto para exibição no system prompt */
    label: string;
    category: ToolCategory;
    description: string;
    actions: SubAction[];
}
/**
 * Todas as tools composits e suas sub-actions.
 */
export declare const TOOL_TAXONOMY: CompositeTool[];
/**
 * Tools que NÃO foram compostas (mantidas isoladas).
 *
 * Derivado de `STANDALONE_CATEGORIES` para que exista uma única fonte do
 * catálogo.
 */
export declare const STANDALONE_TOOLS: string[];
/** Contar total de tools ativas (composits + standalone) */
export declare function countActiveTools(): {
    composite: number;
    standalone: number;
    total: number;
};
