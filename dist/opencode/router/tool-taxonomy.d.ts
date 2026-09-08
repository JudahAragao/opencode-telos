/**
 * Tool Taxonomy — Mapeamento hierárquico de tools do SDD.
 *
 * Cada tool composta agrupa tools originais relacionadas por domínio.
 * O LLM chama: `sdd.{composite}(action="sub_action")`
 *
 * Base para: router (intent classification), state gate, e redução de tools.
 */
export type ToolCategory = "graph" | "workflow" | "analysis" | "quality" | "sync" | "enterprise" | "admin";
export interface SubAction {
    name: string;
    description: string;
    /** Tools originais que esta sub-action substitui */
    replaces: string[];
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
 * As tools originais listadas em `replaces` são deprecated e mantidas por compatibilidade.
 */
export declare const TOOL_TAXONOMY: CompositeTool[];
/** Mapeamento: tool original → tool composta + action */
export declare const TOOL_TO_COMPOSITE: Map<string, {
    composite: string;
    action: string;
}>;
/** Tools que NÃO foram compostas (mantidas isoladas) */
export declare const STANDALONE_TOOLS: string[];
/** Todas as tools originais que foram substituídas por composits */
export declare const DEPRECATED_TOOLS: string[];
/** Verificar se uma tool original foi composta */
export declare function isDeprecatedTool(toolName: string): boolean;
/** Obter a tool composta equivalente */
export declare function getCompositeForTool(toolName: string): {
    composite: string;
    action: string;
} | undefined;
/** Contar total de tools ativas (composits + standalone) */
export declare function countActiveTools(): {
    composite: number;
    standalone: number;
    total: number;
};
