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
import type { NodeType, RelationshipType } from "../domain/types.js";
export type RelationshipKind = "structural" | "semantic";
export interface RelationshipRule {
    /** Tipo da aresta. */
    type: RelationshipType;
    /** Tipos de nó aceitos na origem. */
    from: NodeType[];
    /** Tipos de nó aceitos no destino. */
    to: NodeType[];
    /**
     * Tipo inverso. Se (from,to,type) e (to,from,inverse) coexistirem, um dos
     * dois é redundante e deve ser removido pela integridade.
     */
    inverse?: RelationshipType;
    /** Estrutural (hierarquia) ou semântica (rastreabilidade). */
    kind: RelationshipKind;
}
/**
 * Lista runtime de TODOS os tipos de relacionamento válidos.
 *
 * O union de `RelationshipType` é apagado em runtime; esta lista é a forma
 * consultável. O bloco de asserção abaixo falha em compilação se um membro do
 * union ficar de fora, então ela não pode divergir silenciosamente.
 */
export declare const RELATIONSHIP_TYPES: readonly ["contains", "depends_on", "requires", "implements", "implemented_by", "satisfied_by", "affects", "modifies", "creates", "deletes", "uses", "calls", "persists_to", "exposes", "tested_by", "tests", "derived_from", "contradicts", "supersedes", "replaces", "blocked_by", "belongs_to", "owned_by", "triggered_by", "flows_to", "deprecates", "migrates_to", "experimented_by", "flagged_by", "validates", "influences", "constrains", "applies_to", "owned_by_tenant", "monitored_by", "alerted_by", "incident_in", "detected_in", "tracked_by", "resolves", "evidenced_by", "sla_for", "defines", "specifies", "operates_on", "traces_to", "has_acceptance_criterion", "guides"];
/** Conjunto de tipos válidos, para validação O(1). */
export declare const KNOWN_RELATIONSHIP_TYPES: ReadonlySet<string>;
/**
 * Normaliza um tipo de relacionamento vindo de input externo (LLM, regex,
 * migração). Retorna `null` quando o valor não é válido nem um sinônimo.
 */
export declare function normalizeRelationshipType(value: unknown): RelationshipType | null;
/** Verifica se um valor é um tipo de relacionamento válido. */
export declare function isKnownRelationshipType(value: unknown): boolean;
/** Lista legível dos tipos válidos, para prompts e mensagens de erro. */
export declare function describeRelationshipTypes(): string;
/**
 * Matriz canônica. A ordem importa apenas para a busca de convenção em
 * `getCanonicalRelationshipType` (regras mais específicas primeiro).
 */
export declare const RELATIONSHIP_RULES: RelationshipRule[];
/** Mapa tipo → tipo inverso, derivado das regras. */
export declare const INVERSE_OF: Partial<Record<RelationshipType, RelationshipType>>;
/**
 * Arestas fracas: criadas como último recurso, nunca contam como prova de
 * rastreabilidade e podem ser substituídas por uma aresta semântica real.
 */
export declare const WEAK_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType>;
/**
 * Arestas estruturais: apenas hierarquia (`contains`/`belongs_to`). Mantêm o
 * grafo conectado, mas NÃO provam rastreabilidade (por isso o auto-fix de
 * órfãos via `contains` não conta como cobertura).
 */
export declare const STRUCTURAL_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType>;
/**
 * Arestas que provam rastreabilidade real (ligação semântica entre
 * especificação, implementação, verificação e mudança).
 */
export declare const TRACEABILITY_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType>;
/**
 * Quando duas arestas inversas descrevem o mesmo fato (ex.:
 * `requirement --specifies--> feature` + `feature --satisfied_by--> requirement`),
 * a integridade mantém o tipo preferido e remove o outro.
 */
export declare const PREFERRED_RELATIONSHIP_TYPES: ReadonlySet<RelationshipType>;
/**
 * Entre dois tipos inversos, retorna o preferido. Se nenhum for preferido,
 * mantém `a` (ordem estável do grafo).
 */
export declare function preferredInverseType(a: RelationshipType | string, b: RelationshipType | string): "a" | "b";
/**
 * Verifica se uma aresta é permitida pela matriz canônica.
 * Sempre permissivo para tipos desconhecidos (compatibilidade retroativa).
 */
export declare function isRelationshipAllowed(fromType: NodeType | string, type: RelationshipType | string, toType: NodeType | string): boolean;
/**
 * Retorna o tipo de aresta canônico para um par de tipos de nó, ou `null`
 * quando não há convenção definida. Usado pela inferência e pela integridade.
 */
export declare function getCanonicalRelationshipType(fromType: NodeType | string, toType: NodeType | string): RelationshipType | null;
/** Tipo inverso de uma aresta, quando existe. */
export declare function getInverseRelationshipType(type: RelationshipType | string): RelationshipType | undefined;
/** Aresta fraca (fallback), que não deve contar como rastreabilidade. */
export declare function isWeakRelationship(type: RelationshipType | string): boolean;
/** Aresta puramente estrutural (hierarquia). */
export declare function isStructuralRelationship(type: RelationshipType | string): boolean;
/** Aresta que prova rastreabilidade real. */
export declare function isTraceabilityRelationship(type: RelationshipType | string): boolean;
/** Chave estável de uma aresta, ignorando metadados. */
export declare function relationshipKey(from: string, to: string, type: string): string;
/**
 * Par inverso de chaves: retorna a chave da aresta inversa que tornaria
 * (from,to,type) redundante, ou `null` se o tipo não tiver inverso.
 */
export declare function inverseKeyOf(from: string, to: string, type: string): string | null;
