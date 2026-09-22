/**
 * Schema canônico de relacionamentos do Knowledge Graph.
 *
 * Fonte única de verdade para:
 * - quais combinações `{fromType} --[type]--> {toType}` são válidas;
 * - qual é o tipo inverso de cada aresta (para não duplicar o mesmo fato);
 * - quais tipos representam rastreabilidade real (e quais são apenas
 *   estruturais ou fallback fraco).
 *
 * Todo o resto do sistema (integridade, inferência, validação, migração)
 * deve consultar este módulo em vez de manter listas locais divergentes.
 */

import type { NodeType, RelationshipType } from "../domain/types.js"

export type RelationshipKind = "structural" | "semantic"

export interface RelationshipRule {
  /** Tipo da aresta. */
  type: RelationshipType
  /** Tipos de nó aceitos na origem. */
  from: NodeType[]
  /** Tipos de nó aceitos no destino. */
  to: NodeType[]
  /**
   * Tipo inverso. Se (from,to,type) e (to,from,inverse) coexistirem, um dos
   * dois é redundante e deve ser removido pela integridade.
   */
  inverse?: RelationshipType
  /** Estrutural (hierarquia) ou semântica (rastreabilidade). */
  kind: RelationshipKind
}

/** Qualquer tipo de nó — usado para regras universais. */
const ANY: NodeType[] = [
  "project", "domain", "feature", "requirement", "business_rule", "actor",
  "entity", "value_object", "flow", "use_case", "architecture_component",
  "module", "api", "endpoint", "database", "table", "field", "task", "test",
  "file", "symbol", "change", "decision", "constraint", "assumption",
  "constitution", "bug_fix", "hotfix", "refactoring", "deprecation",
  "migration", "experiment", "feature_flag", "tenant", "metric", "alert",
  "incident", "sla", "milestone",
]

const SPEC_NODES: NodeType[] = [
  "domain", "feature", "requirement", "business_rule", "actor", "entity",
  "value_object", "flow", "use_case", "architecture_component", "module",
  "api", "endpoint", "database", "table", "field",
]

/**
 * Matriz canônica. A ordem importa apenas para a busca de convenção em
 * `getCanonicalRelationshipType` (regras mais específicas primeiro).
 */
export const RELATIONSHIP_RULES: RelationshipRule[] = [
  // ── Hierarquia estrutural ─────────────────────────────────────────
  { type: "contains", from: ["project"], to: ANY, kind: "structural" },
  { type: "contains", from: ["domain"], to: ["feature", "requirement", "entity", "business_rule", "use_case", "flow"], kind: "structural" },
  { type: "contains", from: ["api"], to: ["endpoint"], kind: "structural", inverse: "belongs_to" },
  { type: "contains", from: ["database"], to: ["table"], kind: "structural", inverse: "belongs_to" },
  { type: "contains", from: ["table"], to: ["field"], kind: "structural", inverse: "belongs_to" },
  { type: "contains", from: ["file"], to: ["symbol", "test"], kind: "structural", inverse: "belongs_to" },
  { type: "contains", from: ["architecture_component"], to: ["module"], kind: "structural", inverse: "belongs_to" },
  { type: "contains", from: ["milestone"], to: ["change", "task", "feature", "requirement", "use_case", "business_rule", "endpoint", "module"], kind: "structural", inverse: "belongs_to" },
  { type: "belongs_to", from: ["endpoint"], to: ["api"], kind: "structural", inverse: "contains" },
  { type: "belongs_to", from: ["table"], to: ["database"], kind: "structural", inverse: "contains" },
  { type: "belongs_to", from: ["field"], to: ["table"], kind: "structural", inverse: "contains" },
  { type: "belongs_to", from: ["symbol", "test"], to: ["file"], kind: "structural", inverse: "contains" },
  { type: "belongs_to", from: ["change", "task", "feature", "requirement", "use_case", "business_rule", "endpoint", "module"], to: ["milestone"], kind: "structural", inverse: "contains" },

  // ── Especificação: requirement ↔ feature ──────────────────────────
  { type: "specifies", from: ["requirement"], to: ["feature", "use_case", "flow", "business_rule"], kind: "semantic", inverse: "satisfied_by" },
  { type: "satisfied_by", from: ["feature", "use_case", "flow"], to: ["requirement"], kind: "semantic", inverse: "specifies" },

  // ── Implementação: endpoint/file/symbol ↔ feature/requirement ─────
  { type: "implements", from: ["endpoint", "file", "module", "symbol", "task", "architecture_component", "api"], to: ["feature", "requirement", "use_case", "business_rule", "flow"], kind: "semantic", inverse: "implemented_by" },
  { type: "implemented_by", from: ["feature", "requirement", "use_case", "business_rule", "flow"], to: ["endpoint", "file", "module", "symbol", "task"], kind: "semantic", inverse: "implements" },

  // ── Acesso a dados: endpoint ↔ entity ─────────────────────────────
  { type: "operates_on", from: ["endpoint", "api", "module", "symbol", "use_case"], to: ["entity", "value_object", "table"], kind: "semantic" },
  { type: "exposes", from: ["endpoint", "api"], to: ["entity", "value_object"], kind: "semantic" },
  { type: "persists_to", from: ["entity", "value_object", "module", "file"], to: ["database", "table", "architecture_component"], kind: "semantic" },

  // ── Regras, decisões e uso ────────────────────────────────────────
  { type: "constrains", from: ["business_rule", "constraint"], to: ["feature", "requirement", "entity", "use_case", "field"], kind: "semantic" },
  { type: "applies_to", from: ["business_rule", "constraint"], to: ["architecture_component", "module", "domain"], kind: "semantic" },
  { type: "requires", from: ["feature", "requirement", "use_case"], to: ["business_rule", "constraint", "entity", "value_object"], kind: "semantic" },
  { type: "uses", from: ["feature", "use_case", "file", "module", "symbol"], to: ["entity", "value_object", "architecture_component", "module", "file", "symbol"], kind: "semantic" },
  { type: "influences", from: ["decision"], to: ["feature", "architecture_component", "module", "requirement"], kind: "semantic" },
  { type: "validates", from: ["project", "constitution", "test"], to: ["constitution", "requirement", "feature"], kind: "semantic" },

  // ── Verificação ───────────────────────────────────────────────────
  { type: "tested_by", from: ["requirement", "feature", "use_case"], to: ["test"], kind: "semantic", inverse: "tests" },
  { type: "tests", from: ["test"], to: ["requirement", "feature", "use_case"], kind: "semantic", inverse: "tested_by" },

  // ── Código-fonte ──────────────────────────────────────────────────
  { type: "calls", from: ["symbol"], to: ["symbol"], kind: "semantic" },
  { type: "depends_on", from: ["feature", "module", "symbol", "file", "architecture_component", "requirement", "task"], to: ["feature", "module", "symbol", "file", "architecture_component", "requirement", "task", "business_rule"], kind: "semantic" },

  // ── Mudanças ──────────────────────────────────────────────────────
  { type: "affects", from: ["change"], to: SPEC_NODES, kind: "semantic" },
  { type: "modifies", from: ["change"], to: ["file", "symbol"], kind: "semantic" },
  { type: "affects", from: ["change"], to: ["task"], kind: "semantic" },
  { type: "creates", from: ["change"], to: ANY, kind: "semantic" },
  { type: "deletes", from: ["change"], to: ANY, kind: "semantic" },

  // ── Fallback fraco (não conta como rastreabilidade forte) ─────────
  { type: "traces_to", from: ANY, to: ANY, kind: "semantic" },
]

/** Mapa tipo → tipo inverso, derivado das regras. */
export const INVERSE_OF: Partial<Record<RelationshipType, RelationshipType>> = (() => {
  const map: Partial<Record<RelationshipType, RelationshipType>> = {}
  for (const rule of RELATIONSHIP_RULES) {
    if (rule.inverse && !map[rule.type]) map[rule.type] = rule.inverse
    if (rule.inverse && !map[rule.inverse]) map[rule.inverse] = rule.type
  }
  return map
})()

/**
 * Arestas fracas: criadas como último recurso, nunca contam como prova de
 * rastreabilidade e podem ser substituídas por uma aresta semântica real.
 */
export const WEAK_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType> = new Set([
  "traces_to",
])

/**
 * Arestas estruturais: apenas hierarquia (`contains`/`belongs_to`). Mantêm o
 * grafo conectado, mas NÃO provam rastreabilidade (por isso o auto-fix de
 * órfãos via `contains` não conta como cobertura).
 */
export const STRUCTURAL_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType> = new Set([
  "contains",
  "belongs_to",
])

/**
 * Arestas que provam rastreabilidade real (ligação semântica entre
 * especificação, implementação, verificação e mudança).
 */
export const TRACEABILITY_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType> = new Set([
  "specifies",
  "satisfied_by",
  "implements",
  "implemented_by",
  "operates_on",
  "exposes",
  "persists_to",
  "tested_by",
  "tests",
  "affects",
  "modifies",
  "constrains",
  "requires",
  "influences",
  "validates",
  "uses",
  "calls",
  "depends_on",
])

/**
 * Quando duas arestas inversas descrevem o mesmo fato (ex.:
 * `requirement --specifies--> feature` + `feature --satisfied_by--> requirement`),
 * a integridade mantém o tipo preferido e remove o outro.
 */
export const PREFERRED_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType> = new Set([
  "specifies",
  "implements",
  "contains",
  "tested_by",
  "persists_to",
  "operates_on",
])

/**
 * Entre dois tipos inversos, retorna o preferido. Se nenhum for preferido,
 * mantém `a` (ordem estável do grafo).
 */
export function preferredInverseType(
  a: RelationshipType | string,
  b: RelationshipType | string,
): "a" | "b" {
  const aPreferred = PREFERRED_RELATIONSHIP_TYPES.has(a as RelationshipType)
  const bPreferred = PREFERRED_RELATIONSHIP_TYPES.has(b as RelationshipType)
  if (aPreferred && !bPreferred) return "a"
  if (bPreferred && !aPreferred) return "b"
  return "a"
}

/** Índice type → regras, para busca rápida. */
const RULES_BY_TYPE = new Map<RelationshipType, RelationshipRule[]>()
for (const rule of RELATIONSHIP_RULES) {
  const list = RULES_BY_TYPE.get(rule.type)
  if (list) list.push(rule)
  else RULES_BY_TYPE.set(rule.type, [rule])
}

/**
 * Verifica se uma aresta é permitida pela matriz canônica.
 * Sempre permissivo para tipos desconhecidos (compatibilidade retroativa).
 */
export function isRelationshipAllowed(
  fromType: NodeType | string,
  type: RelationshipType | string,
  toType: NodeType | string,
): boolean {
  const rules = RULES_BY_TYPE.get(type as RelationshipType)
  if (!rules || rules.length === 0) return true
  return rules.some(
    (rule) => rule.from.includes(fromType as NodeType) && rule.to.includes(toType as NodeType),
  )
}

/**
 * Retorna o tipo de aresta canônico para um par de tipos de nó, ou `null`
 * quando não há convenção definida. Usado pela inferência e pela integridade.
 */
export function getCanonicalRelationshipType(
  fromType: NodeType | string,
  toType: NodeType | string,
): RelationshipType | null {
  for (const rule of RELATIONSHIP_RULES) {
    if (rule.type === "traces_to") continue
    if (rule.from.includes(fromType as NodeType) && rule.to.includes(toType as NodeType)) {
      return rule.type
    }
  }
  return null
}

/** Tipo inverso de uma aresta, quando existe. */
export function getInverseRelationshipType(
  type: RelationshipType | string,
): RelationshipType | undefined {
  return INVERSE_OF[type as RelationshipType]
}

/** Aresta fraca (fallback), que não deve contar como rastreabilidade. */
export function isWeakRelationship(type: RelationshipType | string): boolean {
  return WEAK_RELATIONSHIP_TYPES.has(type as RelationshipType)
}

/** Aresta puramente estrutural (hierarquia). */
export function isStructuralRelationship(type: RelationshipType | string): boolean {
  return STRUCTURAL_RELATIONSHIP_TYPES.has(type as RelationshipType)
}

/** Aresta que prova rastreabilidade real. */
export function isTraceabilityRelationship(type: RelationshipType | string): boolean {
  return TRACEABILITY_RELATIONSHIP_TYPES.has(type as RelationshipType)
}

/** Chave estável de uma aresta, ignorando metadados. */
export function relationshipKey(from: string, to: string, type: string): string {
  return `${from}||${to}||${type}`
}

/**
 * Par inverso de chaves: retorna a chave da aresta inversa que tornaria
 * (from,to,type) redundante, ou `null` se o tipo não tiver inverso.
 */
export function inverseKeyOf(from: string, to: string, type: string): string | null {
  const inverse = getInverseRelationshipType(type)
  if (!inverse) return null
  return relationshipKey(to, from, inverse)
}
