/**
 * Relationship inference engine.
 *
 * Rebuilds the graph traceability deterministically and idempotently, covering
 * the gaps that regex/keyword construction used to leave:
 *   - requirement  --specifies-->  feature
 *   - endpoint     --implements--> feature
 *   - file/module  --implements--> feature
 *   - endpoint     --operates_on--> entity
 *   - task         --implements--> requirement/feature
 *   - task/change  --belongs_to--> milestone
 *
 * Toda aresta inferida carrega `metadata` com `inferred`, `method`,
 * `confidence` and `evidence`, so it can be audited and overridden by an
 * explicit decision. The engine is conservative: it only materializes the best
 * match above the confidence threshold and never creates a cycle, self-loop
 * ou par inverso redundante.
 */

import type { AnyNode, KnowledgeGraph, NodeType, RelationshipType } from "../domain/types.js"
import { addRelationship, getNode, updateNode } from "../graph/engine.js"
import {
  getCanonicalRelationshipType,
  getInverseRelationshipType,
  isRelationshipAllowed,
  preferredInverseType,
  relationshipKey,
} from "../graph/schema.js"
import { sddDebug } from "../log.js"

export type InferenceMethod =
  | "explicit-metadata"
  | "handler-match"
  | "path-match"
  | "name-match"
  | "field-match"
  | "weak-fallback"

export interface InferenceProposal {
  from: string
  to: string
  type: RelationshipType
  confidence: number
  method: InferenceMethod
  evidence?: string
}

export interface InferenceOptions {
  /** Minimum confidence to materialize an edge (default: 0.5). */
  minConfidence?: number
  /** Criar/ligar milestones a partir de `metadata.milestone` (default: true). */
  includeMilestones?: boolean
  /** Normalizar pares inversos antes de inferir (default: true). */
  normalizeInverses?: boolean
  /** Maximum targets per (node, type) in name/path heuristics (default: 2). */
  maxTargetsPerType?: number
}

export interface InferenceResult {
  proposals: number
  applied: number
  skipped: number
  normalized: number
  milestones_created: number
  by_type: Record<string, number>
}

const DEFAULT_MIN_CONFIDENCE = 0.5
const DEFAULT_MAX_TARGETS = 2

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "that", "this", "are", "was",
  "were", "api", "src", "app", "lib", "index", "main", "core", "util", "utils",
  "types", "type", "test", "tests", "spec", "specs", "e2e", "unit", "integration",
  "get", "post", "put", "patch", "delete", "head", "options", "any", "http", "https",
  "ts", "tsx", "js", "jsx", "mts", "cts", "json", "yaml", "yml", "d",
])

// ── Tokenization and scoring ─────────────────────────────────────────

function tokenize(text: string | undefined): Set<string> {
  const tokens = new Set<string>()
  if (!text) return tokens
  // Divide camelCase/PascalCase (ApiKey → Api Key), mas preserva siglas
  // glued to digits (2FA stays "2fa", it does not become "2 fa").
  const expanded = text
    .replace(/([a-z0-9])([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9\u00C0-\u024F]+/g, " ")
    .toLowerCase()
  for (const token of expanded.split(/\s+/)) {
    if (token.length <= 2 || STOPWORDS.has(token)) continue
    tokens.add(token)
    // Forma singular leve, para casar `keys` ↔ `key`, `sessions` ↔ `session`.
    if (token.length > 3 && token.endsWith("s")) tokens.add(token.slice(0, -1))
  }
  return tokens
}

/** Mutual coverage of the smaller set (0..1). Robust to long paths. */
function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let hits = 0
  for (const token of a) if (b.has(token)) hits++
  return hits / Math.min(a.size, b.size)
}

function nameTokens(node: AnyNode): Set<string> {
  return tokenize(node.name)
}

function pathTokens(node: AnyNode): Set<string> {
  const meta = node.metadata as Record<string, unknown>
  const path = typeof meta.path === "string" ? meta.path : node.name
  return tokenize(path)
}

/** Search tokens for code nodes (file/module/symbol). */
function codeTokens(node: AnyNode): Set<string> {
  const meta = node.metadata as Record<string, unknown>
  const parts = [node.name]
  if (typeof meta.path === "string") parts.push(meta.path)
  if (typeof meta.file_path === "string") parts.push(meta.file_path)
  return tokenize(parts.join(" "))
}

// ── Resolving declared references ────────────────────────────────────

function resolveReference(graph: KnowledgeGraph, reference: unknown): AnyNode | undefined {
  if (typeof reference !== "string" || reference.length === 0) return undefined
  const byId = getNode(graph, reference)
  if (byId) return byId
  const lower = reference.toLowerCase()
  return graph.nodes.find((node) => node.name.toLowerCase() === lower)
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.length > 0)
  if (typeof value === "string" && value.length > 0) return [value]
  return []
}

// ── Milestone creation/linking ───────────────────────────────────────

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
}

/**
 * Garante que todo `metadata.milestone` (string) declarado em change/task
 * exists as a `milestone` node and is linked by `belongs_to`.
 */
export function ensureMilestoneNodes(graph: KnowledgeGraph): number {
  let created = 0
  const milestoneCache = new Map<string, string>()

  const findOrCreateMilestone = (name: string, releaseVersion?: string): string | undefined => {
    const cacheKey = `${name}::${releaseVersion ?? ""}`
    const cached = milestoneCache.get(cacheKey)
    if (cached) return cached

    const existing = graph.nodes.find(
      (node) => node.type === "milestone" && node.name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      // Stamps the release version when discovered through metadata.release.
      if (releaseVersion && !(existing.metadata as Record<string, unknown>).release_version) {
        const updates: Partial<AnyNode> = {}
        updates.metadata = {
          ...(existing.metadata as Record<string, unknown>),
          release_version: releaseVersion,
        } as AnyNode["metadata"]
        updateNode(graph, existing.id, updates)
      }
      milestoneCache.set(cacheKey, existing.id)
      return existing.id
    }

    const id = `MILESTONE-${slugify(name)}`
    if (getNode(graph, id)) {
      milestoneCache.set(cacheKey, id)
      return id
    }

    const now = new Date().toISOString()
    graph.nodes.push({
      id,
      type: "milestone",
      name,
      status: "DRAFT",
      version: 1,
      metadata: {
        milestone_name: name,
        change_ids: [],
        ...(releaseVersion ? { release_version: releaseVersion } : {}),
      },
      created_at: now,
      updated_at: now,
    } as AnyNode)
    created++
    milestoneCache.set(cacheKey, id)
    return id
  }

  for (const node of [...graph.nodes]) {
    if (node.type !== "change" && node.type !== "task") continue
    const meta = node.metadata as Record<string, unknown>
    const namedTargets: Array<{ name: string; release?: string }> = [
      ...readStringArray(meta.milestone).map((name) => ({ name })),
      ...readStringArray(meta.milestone_name).map((name) => ({ name })),
      ...readStringArray(meta.release).map((name) => ({ name, release: name })),
    ]
    const milestoneId = typeof meta.milestone_id === "string" ? meta.milestone_id : undefined
    const targetIds = new Set<string>()
    if (milestoneId && getNode(graph, milestoneId)) targetIds.add(milestoneId)
    for (const target of namedTargets) {
      const id = findOrCreateMilestone(target.name.trim(), target.release)
      if (id) targetIds.add(id)
    }

    let primary: string | undefined
    for (const targetId of targetIds) {
      if (targetId === node.id) continue
      primary ??= targetId
      try {
        addRelationship(graph, node.id, targetId, "belongs_to", {
          inferred: true,
          method: "explicit-metadata",
          confidence: 1,
          created_by: "inference-engine",
        })
      } catch {
        // Already exists or would create a cycle — the intent stays recorded in metadata.
      }
    }

    // Mirrors the link into metadata.milestone_id so tools/reports
    // encontrem o release sem depender da aresta.
    if (primary && meta.milestone_id !== primary) {
      const updates: Partial<AnyNode> = {}
      updates.metadata = {
        ...(node.metadata as Record<string, unknown>),
        milestone_id: primary,
      } as AnyNode["metadata"]
      updateNode(graph, node.id, updates)
    }
  }

  return created
}

// ── Propostas ────────────────────────────────────────────────────────

function nodeType(id: string, graph: KnowledgeGraph): NodeType | undefined {
  return getNode(graph, id)?.type
}

// ── Main inference ───────────────────────────────────────────────────

/**
 * Computes the missing edges in the graph, without mutating it.
 */
export function inferRelationships(
  graph: KnowledgeGraph,
  options: InferenceOptions = {},
): InferenceProposal[] {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE
  const maxTargets = options.maxTargetsPerType ?? DEFAULT_MAX_TARGETS
  const existing = new Set(graph.relationships.map((rel) => relationshipKey(rel.from, rel.to, rel.type)))
  const proposals = new Map<string, InferenceProposal>()

  const add = (proposal: InferenceProposal): void => {
    if (proposal.from === proposal.to) return
    if (proposal.confidence < minConfidence) return
    const fromType = nodeType(proposal.from, graph)
    const toType = nodeType(proposal.to, graph)
    if (!fromType || !toType) return
    if (!isRelationshipAllowed(fromType, proposal.type, toType)) return

    const key = relationshipKey(proposal.from, proposal.to, proposal.type)
    if (existing.has(key)) return
    // Does not propose an edge if the preferred inverse pair already exists.
    const inverse = getInverseRelationshipType(proposal.type)
    if (inverse) {
      const inverseKey = relationshipKey(proposal.to, proposal.from, inverse)
      if (existing.has(inverseKey) && preferredInverseType(inverse, proposal.type) === "a") return
    }

    const current = proposals.get(key)
    if (!current || proposal.confidence > current.confidence) proposals.set(key, proposal)
  }

  // Memoizes tokenization per node: without it the heuristic would be O(files × features)
  // recomputando os mesmos tokens repetidamente em grafos grandes.
  const tokenCache = new Map<string, Set<string>>()
  const cachedNameTokens = (target: AnyNode): Set<string> => {
    let tokens = tokenCache.get(target.id)
    if (!tokens) {
      tokens = nameTokens(target)
      tokenCache.set(target.id, tokens)
    }
    return tokens
  }

  const nodesByType = new Map<NodeType, AnyNode[]>()
  for (const node of graph.nodes) {
    const list = nodesByType.get(node.type)
    if (list) list.push(node)
    else nodesByType.set(node.type, [node])
  }
  const features = nodesByType.get("feature") ?? []
  const requirements = nodesByType.get("requirement") ?? []
  const entities = nodesByType.get("entity") ?? []

  const bestMatches = (
    source: AnyNode,
    sourceTokens: Set<string>,
    candidates: AnyNode[],
    type: RelationshipType,
    method: InferenceMethod,
    baseConfidence: number,
    minScore: number,
  ): void => {
    const scored = candidates
      .filter((candidate) => candidate.id !== source.id)
      .map((candidate) => ({
        candidate,
        score: overlapScore(sourceTokens, cachedNameTokens(candidate)),
      }))
      .filter((entry) => entry.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTargets)

    for (const { candidate, score } of scored) {
      add({
        from: source.id,
        to: candidate.id,
        type,
        confidence: Math.min(0.9, baseConfidence + score * 0.4),
        method,
        evidence: `token overlap ${score.toFixed(2)} with "${candidate.name}"`,
      })
    }
  }

  // ── 1. Explicit declarations in metadata ───────────────────────────
  for (const node of graph.nodes) {
    const meta = node.metadata as Record<string, unknown>

    // requirement --specifies--> feature
    if (node.type === "requirement") {
      for (const ref of [...readStringArray(meta.feature), ...readStringArray(meta.feature_id), ...readStringArray(meta.features)]) {
        const target = resolveReference(graph, ref)
        if (target?.type === "feature") {
          add({ from: node.id, to: target.id, type: "specifies", confidence: 1, method: "explicit-metadata", evidence: "metadata.feature" })
        }
      }
    }

    // endpoint/file/module/symbol --implements--> feature
    if (["endpoint", "file", "module", "symbol"].includes(node.type)) {
      for (const ref of [...readStringArray(meta.feature), ...readStringArray(meta.feature_id), ...readStringArray(meta.features)]) {
        const target = resolveReference(graph, ref)
        if (target?.type === "feature") {
          add({ from: node.id, to: target.id, type: "implements", confidence: 1, method: "explicit-metadata", evidence: "metadata.feature" })
        }
      }
    }

    // endpoint --operates_on--> entity
    if (node.type === "endpoint") {
      for (const ref of [...readStringArray(meta.relatedEntity), ...readStringArray(meta.entity), ...readStringArray(meta.entity_id)]) {
        const target = resolveReference(graph, ref)
        if (target?.type === "entity") {
          add({ from: node.id, to: target.id, type: "operates_on", confidence: 1, method: "explicit-metadata", evidence: "metadata.relatedEntity" })
        }
      }
    }

    // task --implements--> requirement/feature/endpoint
    if (node.type === "task") {
      for (const ref of [
        ...readStringArray(meta.requirement_id), ...readStringArray(meta.requirement),
        ...readStringArray(meta.feature_id), ...readStringArray(meta.feature),
        ...readStringArray(meta.endpoint_id),
      ]) {
        const target = resolveReference(graph, ref)
        if (target && ["requirement", "feature", "endpoint", "use_case", "business_rule", "module"].includes(target.type)) {
          add({ from: node.id, to: target.id, type: "implements", confidence: 1, method: "explicit-metadata", evidence: "task metadata link" })
        }
      }
    }

    // feature --satisfied_by--> requirement (canonical: specifies in the reverse sense)
    if (node.type === "feature") {
      for (const ref of [...readStringArray(meta.requirements), ...readStringArray(meta.requirement_ids)]) {
        const target = resolveReference(graph, ref)
        if (target?.type === "requirement") {
          add({ from: target.id, to: node.id, type: "specifies", confidence: 1, method: "explicit-metadata", evidence: "metadata.requirements" })
        }
      }
    }
  }

  // ── 2. Token matching (heuristic) ──────────────────────────────────
  for (const requirement of requirements) {
    bestMatches(requirement, nameTokens(requirement), features, "specifies", "name-match", 0.45, 0.34)
  }

  for (const endpoint of nodesByType.get("endpoint") ?? []) {
    const tokens = new Set([...pathTokens(endpoint), ...nameTokens(endpoint)])
    bestMatches(endpoint, tokens, features, "implements", "path-match", 0.5, 0.34)
    bestMatches(endpoint, tokens, entities, "operates_on", "field-match", 0.5, 0.34)
  }

  for (const codeNode of [
    ...(nodesByType.get("file") ?? []),
    ...(nodesByType.get("module") ?? []),
  ]) {
    bestMatches(codeNode, codeTokens(codeNode), features, "implements", "path-match", 0.5, 0.34)
  }

  for (const task of nodesByType.get("task") ?? []) {
    bestMatches(task, nameTokens(task), requirements, "implements", "name-match", 0.45, 0.4)
    bestMatches(task, nameTokens(task), features, "implements", "name-match", 0.45, 0.4)
  }

  return [...proposals.values()]
}

// ── Application ──────────────────────────────────────────────────────

/**
 * Materializes the proposals in the graph. Idempotent: rerunning does not
 * duplicate edges and respects the canonical matrix and the cycle block.
 */
export function applyInferredRelationships(
  graph: KnowledgeGraph,
  proposals: InferenceProposal[],
): { applied: number; skipped: number; byType: Record<string, number> } {
  let applied = 0
  let skipped = 0
  const byType: Record<string, number> = {}
  const existing = new Set(graph.relationships.map((rel) => relationshipKey(rel.from, rel.to, rel.type)))

  for (const proposal of proposals) {
    const key = relationshipKey(proposal.from, proposal.to, proposal.type)
    const fromType = nodeType(proposal.from, graph)
    const toType = nodeType(proposal.to, graph)
    if (existing.has(key)) {
      skipped++
      continue
    }
    if (!fromType || !toType || !isRelationshipAllowed(fromType, proposal.type, toType)) {
      skipped++
      continue
    }

    // Ensures the canonical direction when a convention exists for the pair.
    const canonical = getCanonicalRelationshipType(fromType, toType)
    const type = canonical && canonical !== "traces_to" && !existing.has(relationshipKey(proposal.from, proposal.to, canonical))
      ? canonical
      : proposal.type

    try {
      addRelationship(graph, proposal.from, proposal.to, type, {
        inferred: true,
        method: proposal.method,
        confidence: proposal.confidence,
        evidence: proposal.evidence,
        created_by: "inference-engine",
      })
      existing.add(relationshipKey(proposal.from, proposal.to, type))
      applied++
      byType[type] = (byType[type] ?? 0) + 1
    } catch (error) {
      skipped++
      sddDebug("inference", `Skipped ${proposal.from} →[${type}]→ ${proposal.to}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { applied, skipped, byType }
}

// ── Inverse normalization ────────────────────────────────────────────

/**
 * Remove pares inversos redundantes, mantendo o tipo preferido
 * (e.g. keeps `specifies` and removes `satisfied_by`).
 */
export function normalizeInverseRelationships(graph: KnowledgeGraph): number {
  const byKey = new Map<string, (typeof graph.relationships)[number]>()
  for (const rel of graph.relationships) {
    byKey.set(relationshipKey(rel.from, rel.to, rel.type), rel)
  }

  const toRemove = new Set<string>()
  for (const rel of graph.relationships) {
    const inverse = getInverseRelationshipType(rel.type)
    if (!inverse) continue
    const inverseKey = relationshipKey(rel.to, rel.from, inverse)
    const inverseRel = byKey.get(inverseKey)
    if (!inverseRel || inverseRel === rel) continue
    if (toRemove.has(rel.id) || toRemove.has(inverseRel.id)) continue

    const preferred = preferredInverseType(rel.type, inverseRel.type)
    toRemove.add(preferred === "a" ? inverseRel.id : rel.id)
  }

  if (toRemove.size === 0) return 0
  graph.relationships = graph.relationships.filter((rel) => !toRemove.has(rel.id))
  graph.metadata.updated_at = new Date().toISOString()
  return toRemove.size
}

// ── Orchestration ────────────────────────────────────────────────────

/**
 * Full flow used by tools, builders and migrations:
 * normaliza inversos, garante milestones e materializa as arestas inferidas.
 */
export function runRelationshipInference(
  graph: KnowledgeGraph,
  options: InferenceOptions = {},
): InferenceResult {
  let normalized = 0
  if (options.normalizeInverses ?? true) {
    normalized = normalizeInverseRelationships(graph)
  }

  let milestonesCreated = 0
  if (options.includeMilestones ?? true) {
    milestonesCreated = ensureMilestoneNodes(graph)
  }

  const proposals = inferRelationships(graph, options)
  const { applied, skipped, byType } = applyInferredRelationships(graph, proposals)

  // Segunda passada: remove pares inversos criados agora (ex.: `specifies`
  // inferido convivendo com um `satisfied_by` legado).
  if (options.normalizeInverses ?? true) {
    normalized += normalizeInverseRelationships(graph)
  }

  return {
    proposals: proposals.length,
    applied,
    skipped,
    normalized,
    milestones_created: milestonesCreated,
    by_type: byType,
  }
}
