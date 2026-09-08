/**
 * Categories — Mapeamento de tools para categorias de intenção.
 *
 * Cada tool é classificada em uma ou mais categorias.
 * O intent classifier usa isso para filtrar tools por categoria.
 *
 * Consumido por: intent-classifier.ts, tool-registry.ts
 * Dependências: tool-taxonomy.ts
 */
/**
 * Categorias de intenção do usuário.
 */
export type IntentCategory = "mutation" | "query" | "workflow" | "analysis" | "quality" | "enterprise" | "admin" | "discovery" | "implementation" | "info";
/**
 * Obtém as categorias de intenção para uma tool.
 */
export declare function getToolCategories(toolName: string): IntentCategory[];
/**
 * Obtém todas as tools de uma categoria de intenção.
 */
export declare function getToolsByCategory(category: IntentCategory): string[];
/**
 * Obtém categorias representadas em um conjunto de tools.
 */
export declare function getCategoriesInToolSet(toolNames: Set<string>): IntentCategory[];
/**
 * Keywords associadas a cada categoria de intenção.
 * Usado como sinal auxiliar no intent classifier.
 */
export declare const CATEGORY_KEYWORDS: Record<IntentCategory, string[]>;
