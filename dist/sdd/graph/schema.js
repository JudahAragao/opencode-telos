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
/**
 * Lista runtime de TODOS os tipos de relacionamento válidos.
 *
 * O union de `RelationshipType` é apagado em runtime; esta lista é a forma
 * consultável. O bloco de asserção abaixo falha em compilação se um membro do
 * union ficar de fora, então ela não pode divergir silenciosamente.
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
];
const _assertNoMissingRelationshipType = true;
void _assertNoMissingRelationshipType;
/** Conjunto de tipos válidos, para validação O(1). */
export const KNOWN_RELATIONSHIP_TYPES = new Set(RELATIONSHIP_TYPES);
/**
 * Sinônimos aceitos na entrada e normalizados para o tipo canônico.
 * A extração por regex e alguns prompts antigos emitiram nomes que não existem
 * no union (`constrained_by`); normalizar evita a aresta ser descartada.
 */
const RELATIONSHIP_SYNONYMS = {
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
};
/**
 * Normaliza um tipo de relacionamento vindo de input externo (LLM, regex,
 * migração). Retorna `null` quando o valor não é válido nem um sinônimo.
 */
export function normalizeRelationshipType(value) {
    if (typeof value !== "string")
        return null;
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (KNOWN_RELATIONSHIP_TYPES.has(key))
        return key;
    return RELATIONSHIP_SYNONYMS[key] ?? null;
}
/** Verifica se um valor é um tipo de relacionamento válido. */
export function isKnownRelationshipType(value) {
    return normalizeRelationshipType(value) !== null;
}
/** Lista legível dos tipos válidos, para prompts e mensagens de erro. */
export function describeRelationshipTypes() {
    return RELATIONSHIP_TYPES.join(", ");
}
/** Qualquer tipo de nó — usado para regras universais. */
const ANY = [
    "project", "domain", "feature", "requirement", "business_rule", "actor",
    "entity", "value_object", "flow", "use_case", "architecture_component",
    "module", "api", "endpoint", "database", "table", "field", "task", "test",
    "file", "symbol", "change", "decision", "constraint", "assumption",
    "constitution", "bug_fix", "hotfix", "refactoring", "deprecation",
    "migration", "experiment", "feature_flag", "tenant", "metric", "alert",
    "incident", "finding", "sla", "milestone",
];
const SPEC_NODES = [
    "domain", "feature", "requirement", "business_rule", "actor", "entity",
    "value_object", "flow", "use_case", "architecture_component", "module",
    "api", "endpoint", "database", "table", "field",
];
/**
 * Matriz canônica. A ordem importa apenas para a busca de convenção em
 * `getCanonicalRelationshipType` (regras mais específicas primeiro).
 */
export const RELATIONSHIP_RULES = [
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
    // ── Descobertas brownfield e resolução ───────────────────────────
    { type: "detected_in", from: ["finding"], to: ANY, kind: "semantic" },
    { type: "tracked_by", from: ["finding"], to: ["task", "change"], kind: "semantic" },
    { type: "resolves", from: ["change", "task", "requirement", "decision", "constraint"], to: ["finding"], kind: "semantic" },
    { type: "evidenced_by", from: ["finding", "change", "requirement", "decision"], to: ANY, kind: "semantic" },
    { type: "derived_from", from: ["requirement", "decision", "constraint"], to: ["finding"], kind: "semantic" },
    // ── Fallback fraco (não conta como rastreabilidade forte) ─────────
    { type: "traces_to", from: ANY, to: ANY, kind: "semantic" },
];
/** Mapa tipo → tipo inverso, derivado das regras. */
export const INVERSE_OF = (() => {
    const map = {};
    for (const rule of RELATIONSHIP_RULES) {
        if (rule.inverse && !map[rule.type])
            map[rule.type] = rule.inverse;
        if (rule.inverse && !map[rule.inverse])
            map[rule.inverse] = rule.type;
    }
    return map;
})();
/**
 * Arestas fracas: criadas como último recurso, nunca contam como prova de
 * rastreabilidade e podem ser substituídas por uma aresta semântica real.
 */
export const WEAK_RELATIONSHIP_TYPES = new Set([
    "traces_to",
]);
/**
 * Arestas estruturais: apenas hierarquia (`contains`/`belongs_to`). Mantêm o
 * grafo conectado, mas NÃO provam rastreabilidade (por isso o auto-fix de
 * órfãos via `contains` não conta como cobertura).
 */
export const STRUCTURAL_RELATIONSHIP_TYPES = new Set([
    "contains",
    "belongs_to",
]);
/**
 * Arestas que provam rastreabilidade real (ligação semântica entre
 * especificação, implementação, verificação e mudança).
 */
export const TRACEABILITY_RELATIONSHIP_TYPES = new Set([
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
]);
/**
 * Quando duas arestas inversas descrevem o mesmo fato (ex.:
 * `requirement --specifies--> feature` + `feature --satisfied_by--> requirement`),
 * a integridade mantém o tipo preferido e remove o outro.
 */
export const PREFERRED_RELATIONSHIP_TYPES = new Set([
    "specifies",
    "implements",
    "contains",
    "tested_by",
    "persists_to",
    "operates_on",
]);
/**
 * Entre dois tipos inversos, retorna o preferido. Se nenhum for preferido,
 * mantém `a` (ordem estável do grafo).
 */
export function preferredInverseType(a, b) {
    const aPreferred = PREFERRED_RELATIONSHIP_TYPES.has(a);
    const bPreferred = PREFERRED_RELATIONSHIP_TYPES.has(b);
    if (aPreferred && !bPreferred)
        return "a";
    if (bPreferred && !aPreferred)
        return "b";
    return "a";
}
/** Índice type → regras, para busca rápida. */
const RULES_BY_TYPE = new Map();
for (const rule of RELATIONSHIP_RULES) {
    const list = RULES_BY_TYPE.get(rule.type);
    if (list)
        list.push(rule);
    else
        RULES_BY_TYPE.set(rule.type, [rule]);
}
/**
 * Verifica se uma aresta é permitida pela matriz canônica.
 * Sempre permissivo para tipos desconhecidos (compatibilidade retroativa).
 */
export function isRelationshipAllowed(fromType, type, toType) {
    const rules = RULES_BY_TYPE.get(type);
    if (!rules || rules.length === 0)
        return true;
    return rules.some((rule) => rule.from.includes(fromType) && rule.to.includes(toType));
}
/**
 * Retorna o tipo de aresta canônico para um par de tipos de nó, ou `null`
 * quando não há convenção definida. Usado pela inferência e pela integridade.
 */
export function getCanonicalRelationshipType(fromType, toType) {
    for (const rule of RELATIONSHIP_RULES) {
        if (rule.type === "traces_to")
            continue;
        if (rule.from.includes(fromType) && rule.to.includes(toType)) {
            return rule.type;
        }
    }
    return null;
}
/** Tipo inverso de uma aresta, quando existe. */
export function getInverseRelationshipType(type) {
    return INVERSE_OF[type];
}
/** Aresta fraca (fallback), que não deve contar como rastreabilidade. */
export function isWeakRelationship(type) {
    return WEAK_RELATIONSHIP_TYPES.has(type);
}
/** Aresta puramente estrutural (hierarquia). */
export function isStructuralRelationship(type) {
    return STRUCTURAL_RELATIONSHIP_TYPES.has(type);
}
/** Aresta que prova rastreabilidade real. */
export function isTraceabilityRelationship(type) {
    return TRACEABILITY_RELATIONSHIP_TYPES.has(type);
}
/** Chave estável de uma aresta, ignorando metadados. */
export function relationshipKey(from, to, type) {
    return `${from}||${to}||${type}`;
}
/**
 * Par inverso de chaves: retorna a chave da aresta inversa que tornaria
 * (from,to,type) redundante, ou `null` se o tipo não tiver inverso.
 */
export function inverseKeyOf(from, to, type) {
    const inverse = getInverseRelationshipType(type);
    if (!inverse)
        return null;
    return relationshipKey(to, from, inverse);
}
