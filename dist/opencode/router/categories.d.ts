/**
 * Categories — Mapeamento de tools para categorias de intenção.
 *
 * Cada tool é classificada em uma ou mais categorias.
 * O intent classifier usa isso para filtrar tools por categoria.
 *
 * Este arquivo é a fonte única do catálogo de tools standalone: a lista de
 * nomes em `STANDALONE_TOOLS` (tool-taxonomy.ts) é derivada de
 * `STANDALONE_CATEGORIES`. Sempre que uma tool nova for registrada em
 * `createSddTools()`, ela precisa de uma entrada aqui — o teste
 * tests/tool-catalog.test.ts falha caso contrário.
 *
 * Consumido por: intent-classifier.ts, tool-registry.ts, state-gate.ts
 * Dependências: nenhuma (módulo puro, sem imports)
 */
/**
 * Categorias de intenção do usuário.
 */
export type IntentCategory = "mutation" | "query" | "workflow" | "analysis" | "quality" | "enterprise" | "admin" | "discovery" | "implementation" | "info";
/**
 * Mapeamento de tools standalone para categorias de intenção.
 */
export declare const STANDALONE_CATEGORIES: Record<string, IntentCategory[]>;
/**
 * Mapeamento de tools composits para categorias de intenção.
 */
export declare const COMPOSITE_CATEGORIES: Record<string, IntentCategory[]>;
/**
 * Obtém as categorias de intenção para uma tool.
 */
export declare function getToolCategories(toolName: string): IntentCategory[];
/**
 * Indica se a tool tem categoria declarada explicitamente (sem fallback).
 */
export declare function hasToolCategory(toolName: string): boolean;
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
