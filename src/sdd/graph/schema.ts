/**
 * Canonical schema of Knowledge Graph relationships.
 *
 * Single source of truth for:
 * - which `{fromType} --[type]--> {toType}` combinations are valid;
 * - what the inverse type of each edge is (so the same fact is not duplicated);
 * - which types represent real traceability (and which are merely
 *   estruturais ou fallback fraco).
 *
 * Everything else in the system (integrity, inference, validation, migration)
 * must consult this module instead of keeping diverging local lists.
 */

import type { NodeType, RelationshipType } from "../domain/types.js"

export type RelationshipKind = "structural" | "semantic"

export interface RelationshipRule {
  /** Tipo da aresta. */
  type: RelationshipType
  /** Node types accepted at the source. */
  from: NodeType[]
  /** Node types accepted at the target. */
  to: NodeType[]
  /**
   * Tipo inverso. Se (from,to,type) e (to,from,inverse) coexistirem, um dos
   * the two is redundant and must be removed by integrity.
   */
  inverse?: RelationshipType
  /** Structural (hierarchy) or semantic (traceability). */
  kind: RelationshipKind
}

/**
 * Runtime list of ALL valid relationship types.
 *
 * The `RelationshipType` union is erased at runtime; this list is the queryable
 * form. The assertion block below fails to compile if a union member is missing,
 * so it cannot silently diverge.
 */
export const RELATIONSHIP_TYPES = [
  "contains", "depends_on", "requires", "implements", "implemented_by",
  "satisfied_by", "affects", "modifies", "creates", "deletes", "uses",
  "calls", "persists_to", "exposes", "tested_by", "tests", "derived_from",
  "contradicts", "supersedes", "replaces", "blocked_by", "belongs_to",
  "owned_by", "triggered_by", "flows_to", "deprecates", "migrates_to",
  "experimented_by", "flagged_by", "validates", "influences", "constrains",
  "applies_to", "owned_by_tenant", "monitored_by", "alerted_by",
  "incident_in", "detected_in", "tracked_by", "resolves", "evidenced_by", "sla_for", "defines", "specifies", "operates_on", "traces_to",
  "has_acceptance_criterion", "guides",
] as const satisfies readonly RelationshipType[]

/** Compilation guard: no union type may be missing from the runtime list. */
type MissingRelationshipType = Exclude<RelationshipType, (typeof RELATIONSHIP_TYPES)[number]>
const _assertNoMissingRelationshipType: MissingRelationshipType extends never
  ? true
  : ["RELATIONSHIP_TYPES is missing", MissingRelationshipType] = true
void _assertNoMissingRelationshipType

/** Set of valid types, for O(1) validation. */
export const KNOWN_RELATIONSHIP_TYPES: ReadonlySet<string> = new Set(RELATIONSHIP_TYPES)

/**
 * Synonyms accepted on input and normalized to the canonical type.
 * Regex extraction and some older prompts emitted names that do not exist
 * no union (`constrained_by`); normalizar evita a aresta ser descartada.
 */
const RELATIONSHIP_SYNONYMS: Record<string, RelationshipType> = {
  constrained_by: "constrains",
  constrain_by: "constrains",
  constrainedby: "constrains",
  satisfies: "satisfied_by",
  satisfy: "satisfied_by",
  implements_by: "implemented_by",
  implement_by: "implemented_by",
  implementedby: "implemented_by",
  depend_on: "depends_on",
  depends: "depends_on",
  operate_on: "operates_on",
  operates: "operates_on",
  test_by: "tested_by",
  tests_by: "tested_by",
  specify: "specifies",
  persisted_to: "persists_to",
  belongs: "belongs_to",
}

/**
 * Normaliza um tipo de relacionamento vindo de input externo (LLM, regex,
 * migration). Returns `null` when the value is neither valid nor a synonym.
 */
export function normalizeRelationshipType(value: unknown): RelationshipType | null {
  if (typeof value !== "string") return null
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (KNOWN_RELATIONSHIP_TYPES.has(key)) return key as RelationshipType
  return RELATIONSHIP_SYNONYMS[key] ?? null
}

/** Checks whether a value is a valid relationship type. */
export function isKnownRelationshipType(value: unknown): boolean {
  return normalizeRelationshipType(value) !== null
}

/** Readable list of the valid types, for prompts and error messages. */
export function describeRelationshipTypes(): string {
  return RELATIONSHIP_TYPES.join(", ")
}

/** Any node type — used for universal rules. */
const ANY: NodeType[] = [
  "project", "domain", "feature", "requirement", "business_rule", "actor",
  "entity", "value_object", "flow", "use_case", "architecture_component",
  "module", "api", "endpoint", "database", "table", "field", "task", "test",
  "file", "symbol", "change", "decision", "constraint", "assumption",
  "constitution", "bug_fix", "hotfix", "refactoring", "deprecation",
  "migration", "experiment", "feature_flag", "tenant", "metric", "alert",
  "incident", "finding", "sla", "milestone",
  "acceptance_criterion", "guidance",
]

const SPEC_NODES: NodeType[] = [
  "domain", "feature", "requirement", "business_rule", "actor", "entity",
  "value_object", "flow", "use_case", "architecture_component", "module",
  "api", "endpoint", "database", "table", "field",
  "acceptance_criterion",
]

/**
 * Canonical matrix. Order only matters for the convention lookup in
 * `getCanonicalRelationshipType` (more specific rules first).
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
  { type: "contains", from: ["project"], to: ["guidance"], kind: "structural" },
  { type: "belongs_to", from: ["endpoint"], to: ["api"], kind: "structural", inverse: "contains" },
  { type: "belongs_to", from: ["table"], to: ["database"], kind: "structural", inverse: "contains" },
  { type: "belongs_to", from: ["field"], to: ["table"], kind: "structural", inverse: "contains" },
  { type: "belongs_to", from: ["symbol", "test"], to: ["file"], kind: "structural", inverse: "contains" },
  { type: "belongs_to", from: ["change", "task", "feature", "requirement", "use_case", "business_rule", "endpoint", "module"], to: ["milestone"], kind: "structural", inverse: "contains" },

  // ── Specification: requirement ↔ feature ──────────────────────────
  { type: "specifies", from: ["requirement"], to: ["feature", "use_case", "flow", "business_rule"], kind: "semantic", inverse: "satisfied_by" },
  { type: "satisfied_by", from: ["feature", "use_case", "flow"], to: ["requirement"], kind: "semantic", inverse: "specifies" },
  { type: "has_acceptance_criterion", from: ["requirement"], to: ["acceptance_criterion"], kind: "semantic" },
  { type: "guides", from: ["guidance"], to: ANY, kind: "semantic" },

  // ── Implementation: endpoint/file/symbol ↔ feature/requirement ────
  { type: "implements", from: ["endpoint", "file", "module", "symbol", "task", "architecture_component", "api"], to: ["feature", "requirement", "use_case", "business_rule", "flow"], kind: "semantic", inverse: "implemented_by" },
  { type: "implemented_by", from: ["feature", "requirement", "use_case", "business_rule", "flow"], to: ["endpoint", "file", "module", "symbol", "task"], kind: "semantic", inverse: "implements" },

  // ── Acesso a dados: endpoint ↔ entity ─────────────────────────────
  { type: "operates_on", from: ["endpoint", "api", "module", "symbol", "use_case"], to: ["entity", "value_object", "table"], kind: "semantic" },
  { type: "exposes", from: ["endpoint", "api"], to: ["entity", "value_object"], kind: "semantic" },
  { type: "persists_to", from: ["entity", "value_object", "module", "file"], to: ["database", "table", "architecture_component"], kind: "semantic" },

  // ── Rules, decisions and usage ────────────────────────────────────
  { type: "constrains", from: ["business_rule", "constraint"], to: ["feature", "requirement", "entity", "use_case", "field"], kind: "semantic" },
  { type: "applies_to", from: ["business_rule", "constraint"], to: ["architecture_component", "module", "domain"], kind: "semantic" },
  { type: "requires", from: ["feature", "requirement", "use_case"], to: ["business_rule", "constraint", "entity", "value_object"], kind: "semantic" },
  { type: "uses", from: ["feature", "use_case", "file", "module", "symbol"], to: ["entity", "value_object", "architecture_component", "module", "file", "symbol"], kind: "semantic" },
  { type: "influences", from: ["decision"], to: ["feature", "architecture_component", "module", "requirement"], kind: "semantic" },
  { type: "validates", from: ["project", "constitution", "test"], to: ["constitution", "requirement", "feature"], kind: "semantic" },

  // ── Verification ──────────────────────────────────────────────────
  { type: "tested_by", from: ["requirement", "feature", "use_case"], to: ["test"], kind: "semantic", inverse: "tests" },
  { type: "tests", from: ["test"], to: ["requirement", "feature", "use_case"], kind: "semantic", inverse: "tested_by" },

  // ── Source code ───────────────────────────────────────────────────
  { type: "calls", from: ["symbol"], to: ["symbol"], kind: "semantic" },
  { type: "depends_on", from: ["feature", "module", "symbol", "file", "architecture_component", "requirement", "task"], to: ["feature", "module", "symbol", "file", "architecture_component", "requirement", "task", "business_rule"], kind: "semantic" },

  // ── Changes ───────────────────────────────────────────────────────
  { type: "affects", from: ["change"], to: SPEC_NODES, kind: "semantic" },
  { type: "modifies", from: ["change"], to: ["file", "symbol"], kind: "semantic" },
  { type: "affects", from: ["change"], to: ["task"], kind: "semantic" },
  { type: "creates", from: ["change"], to: ANY, kind: "semantic" },
  { type: "deletes", from: ["change"], to: ANY, kind: "semantic" },

  // ── Brownfield findings and resolution ────────────────────────────
  { type: "detected_in", from: ["finding"], to: ANY, kind: "semantic" },
  { type: "tracked_by", from: ["finding"], to: ["task", "change"], kind: "semantic" },
  { type: "resolves", from: ["change", "task", "requirement", "decision", "constraint"], to: ["finding"], kind: "semantic" },
  { type: "evidenced_by", from: ["finding", "change", "requirement", "decision"], to: ANY, kind: "semantic" },
  { type: "derived_from", from: ["requirement", "decision", "constraint"], to: ["finding"], kind: "semantic" },

  // ── Weak fallback (does not count as strong traceability) ─────────
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
 * Weak edges: created as a last resort, they never count as traceability proof
 * and can be replaced by a real semantic edge.
 */
export const WEAK_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType> = new Set([
  "traces_to",
])

/**
 * Structural edges: hierarchy only (`contains`/`belongs_to`). They keep the
 * grafo conectado, mas NÃO provam rastreabilidade (por isso o auto-fix de
 * orphans via `contains` does not count as coverage).
 */
export const STRUCTURAL_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType> = new Set([
  "contains",
  "belongs_to",
])

/**
 * Edges that prove real traceability (semantic link between specification,
 * implementation, verification and change).
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
  "detected_in",
  "tracked_by",
  "resolves",
  "evidenced_by",
  "derived_from",
  "has_acceptance_criterion",
  "guides",
])

/**
 * When two inverse edges describe the same fact (e.g.
 * `requirement --specifies--> feature` + `feature --satisfied_by--> requirement`),
 * integrity keeps the preferred type and removes the other.
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
 * Between two inverse types, returns the preferred one. If neither is preferred,
 * keeps `a` (stable graph order).
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

/** Index type → rules, for fast lookup. */
const RULES_BY_TYPE = new Map<RelationshipType, RelationshipRule[]>()
for (const rule of RELATIONSHIP_RULES) {
  const list = RULES_BY_TYPE.get(rule.type)
  if (list) list.push(rule)
  else RULES_BY_TYPE.set(rule.type, [rule])
}

/**
 * Checks whether an edge is allowed by the canonical matrix.
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
 * Returns the canonical edge type for a pair of node types, or `null` when no
 * convention is defined. Used by inference and by integrity.
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

/** Inverse type of an edge, when one exists. */
export function getInverseRelationshipType(
  type: RelationshipType | string,
): RelationshipType | undefined {
  return INVERSE_OF[type as RelationshipType]
}

/** Weak edge (fallback), which must not count as traceability. */
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

/** Stable key of an edge, ignoring metadata. */
export function relationshipKey(from: string, to: string, type: string): string {
  return `${from}||${to}||${type}`
}

/**
 * Par inverso de chaves: retorna a chave da aresta inversa que tornaria
 * redundant (from,to,type), or `null` if the type has no inverse.
 */
export function inverseKeyOf(from: string, to: string, type: string): string | null {
  const inverse = getInverseRelationshipType(type)
  if (!inverse) return null
  return relationshipKey(to, from, inverse)
}
