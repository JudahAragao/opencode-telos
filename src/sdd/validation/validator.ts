import type { KnowledgeGraph } from "../domain/types.js"
import { validateAgainstConstitution } from "../constitution/validator.js"
import { getPromiseReport } from "../promises/tracker.js"
import { detectContradictions } from "../patterns/contradictions.js"
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js"
import { ensureGraphIntegrity, formatIntegrityReport } from "../graph/integrity.js"
import type { IntegrityReport } from "../graph/integrity.js"
import { validateGraphIntegrity } from "../graph/integrity-guard.js"
import { sddDebug } from "../log.js"

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  integrity?: IntegrityReport
}

export interface ValidationError {
  code: string
  message: string
  node_id?: string
  relationship_id?: string
}

export interface ValidationWarning {
  code: string
  message: string
  node_id?: string
}

export interface ValidationPolicy {
  critical_requirement_without_test: "error" | "warning"
  missing_verification_scenario: "error" | "warning"
}

export const DEFAULT_VALIDATION_POLICY: ValidationPolicy = {
  critical_requirement_without_test: "error",
  missing_verification_scenario: "warning",
}

// ── Validation cache for incremental analysis ────────────────────────
// Thread-safe: each module instance gets its own cache via closure.
// In worker environments, each worker has a separate module scope.

interface ValidationCache {
  result: ValidationResult
  graphVersion: string
  nodeCount: number
  version: number
}

function createValidationCache() {
  let cache: ValidationCache | null = null
  let version = 0

  return {
    get(graphVersion: string): ValidationCache | null {
      if (cache && cache.graphVersion === graphVersion) return cache
      return null
    },
    set(result: ValidationResult, graphVersion: string, nodeCount: number): void {
      version++
      cache = { result, graphVersion, nodeCount, version }
    },
  }
}

const validationCache = createValidationCache()

/**
 * Full graph validation. Checks structural integrity, semantic correctness,
 * references, completeness, constitution, promises, contradictions, and graph integrity.
 */
export function validateGraph(
  graph: KnowledgeGraph,
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY,
  projectDir?: string,
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // Anti-bypass: check for out-of-band modifications
  // We need projectDir to check integrity — extract from graph context
  try {
    // If graph metadata contains a tamper warning, surface it as an error
    const tamperWarning = (graph.metadata as any).__tamper_warning
    if (tamperWarning) {
      errors.push({
        code: "GRAPH_TAMPERED",
        message: tamperWarning,
      })
    }
  } catch (error) { sddDebug("validator", "Legacy tamper check failed", error) }

  if (projectDir) {
    const integrityResult = validateGraphIntegrity(projectDir, graph)
    if (integrityResult.tampered) {
      errors.push({ code: "GRAPH_TAMPERED", message: integrityResult.reason || "Graph integrity validation failed" })
    }
  }

  validateStructural(graph, errors, warnings)
  validateSemantic(graph, errors, warnings, policy)
  validateReferences(graph, errors, warnings)
  validateCompleteness(graph, errors, warnings)

  const constitutionResult = validateAgainstConstitution(graph)
  for (const v of constitutionResult.violations) {
    errors.push({
      code: "CONSTITUTION_VIOLATION",
      message: v.description,
      node_id: v.node_id,
    })
  }

  const promiseReport = getPromiseReport(graph)
  if (promiseReport.violated > 0) {
    warnings.push({
      code: "PROMISES_VIOLATED",
      message: `${promiseReport.violated} specification promises violated`,
    })
  }

  const contradictionReport = detectContradictions(graph)
  for (const c of contradictionReport.contradictions) {
    warnings.push({
      code: "CONTRADICTION",
      message: c.description,
      node_id: c.node_a,
    })
  }

  // Run graph integrity check (detects orphans, disconnected groups, redundancies)
  const integrity = ensureGraphIntegrity(graph, { auto_fix: false })
  if (!integrity.summary.graph_connected) {
    warnings.push({
      code: "DISCONNECTED_GRAPH",
      message: `Graph has ${integrity.summary.disconnected_groups_found} disconnected group(s) with ${integrity.summary.orphans_found} orphan node(s)`,
    })
  }
  if (integrity.summary.redundant_relationships_found > 0) {
    warnings.push({
      code: "REDUNDANT_RELATIONSHIPS",
      message: `${integrity.summary.redundant_relationships_found} redundant relationship(s) detected`,
    })
  }

  const result = {
    valid: errors.length === 0,
    errors,
    warnings,
    integrity,
  }

  // Cache for incremental comparison
  validationCache.set(result, graph.metadata.updated_at, graph.nodes.length)

  return result
}

// ── Non-incremental validators (used by full validation) ─────────────

function validateStructural(
  graph: KnowledgeGraph,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  const ids = new Set<string>()

  for (const rawNode of graph.nodes) {
    const node = rawNode as { id?: string; type?: string; name?: string; status?: string }
    if (!node.id) {
      errors.push({ code: "MISSING_ID", message: "Node missing ID" })
      continue
    }
    if (ids.has(node.id)) {
      errors.push({
        code: "DUPLICATE_ID",
        message: `Duplicate node ID: ${node.id}`,
        node_id: node.id,
      })
    }
    ids.add(node.id)

    if (!node.type) {
      errors.push({
        code: "MISSING_TYPE",
        message: `Node ${node.id} missing type`,
        node_id: node.id,
      })
    }
    if (!node.name) {
      warnings.push({
        code: "MISSING_NAME",
        message: `Node ${node.id} missing name`,
        node_id: node.id,
      })
    }
    if (!node.status) {
      warnings.push({
        code: "MISSING_STATUS",
        message: `Node ${node.id} missing status`,
        node_id: node.id,
      })
    }
  }

  for (const rel of graph.relationships) {
    if (!rel.from) {
      errors.push({
        code: "MISSING_RELATIONSHIP_FROM",
        message: `Relationship ${rel.id} missing 'from'`,
        relationship_id: rel.id,
      })
    }
    if (!rel.to) {
      errors.push({
        code: "MISSING_RELATIONSHIP_TO",
        message: `Relationship ${rel.id} missing 'to'`,
        relationship_id: rel.id,
      })
    }
    if (!rel.type) {
      errors.push({
        code: "MISSING_RELATIONSHIP_TYPE",
        message: `Relationship ${rel.id} missing type`,
        relationship_id: rel.id,
      })
    }
  }
}

function validateSemantic(
  graph: KnowledgeGraph,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY,
): void {
  const { removed, deprecated } = getExclusionSets(graph)
  const requirements = graph.nodes.filter((n) => n.type === "requirement")
  const entities = graph.nodes.filter((n) => n.type === "entity")

  // Check for requirements without tasks
  for (const req of requirements) {
    if (isNodeExcludedOrDeprecated(req.id, req.status, removed, deprecated)) continue
    const hasTask = graph.relationships.some(
      (r) =>
        r.from === req.id &&
        (r.type === "implemented_by" || r.type === "contains" || r.type === "belongs_to"),
    )
    // VERIFIED requirements are already validated, skip warning
    if (!hasTask && req.status !== "VERIFIED") {
      warnings.push({
        code: "REQUIREMENT_NO_TASK",
        message: `Requirement ${req.id} has no implementing task`,
        node_id: req.id,
      })
    }

    const meta = req.metadata as Record<string, unknown>
    const priority = String(meta.priority || "").toLowerCase()
    const hasTestEvidence = graph.relationships.some(
      (r) => r.from === req.id && (r.type === "tested_by" || r.type === "tests"),
    )
    if (priority === "critical" && !hasTestEvidence) {
      const issue = {
        code: "CRITICAL_REQUIREMENT_UNTESTED",
        message: `Critical requirement ${req.id} has no linked test evidence`,
        node_id: req.id,
      }
      if (policy.critical_requirement_without_test === "error") errors.push(issue)
      else warnings.push(issue)
    }

    const verification = meta.verification as Record<string, unknown> | undefined
    if (!Array.isArray(verification?.scenarios) || verification.scenarios.length === 0) {
      const issue = {
        code: "REQUIREMENT_NOT_EXECUTABLE",
        message: `Requirement ${req.id} has no Given/When/Then verification scenario`,
        node_id: req.id,
      }
      if (policy.missing_verification_scenario === "error") errors.push(issue)
      else warnings.push(issue)
    }
  }

  // Check for entities without persistence (multiple strategies)
  for (const entity of entities) {
    if (isNodeExcludedOrDeprecated(entity.id, entity.status, removed, deprecated)) continue
    if (!hasPersistenceMapping(entity, graph)) {
      warnings.push({
        code: "ENTITY_NO_TABLE",
        message: `Entity ${entity.id} has no corresponding table`,
        node_id: entity.id,
      })
    }
  }
}

function validateReferences(
  graph: KnowledgeGraph,
  errors: ValidationError[],
  _warnings: ValidationWarning[],
): void {
  const nodeIds = new Set(graph.nodes.map((n) => n.id))

  for (const rel of graph.relationships) {
    if (rel.from && !nodeIds.has(rel.from)) {
      errors.push({
        code: "DANGLING_REFERENCE",
        message: `Relationship ${rel.id} references non-existent source: ${rel.from}`,
        relationship_id: rel.id,
      })
    }
    if (rel.to && !nodeIds.has(rel.to)) {
      errors.push({
        code: "DANGLING_REFERENCE",
        message: `Relationship ${rel.id} references non-existent target: ${rel.to}`,
        relationship_id: rel.id,
      })
    }
  }

  // Check file references
  for (const node of graph.nodes) {
    const meta = node.metadata as Record<string, unknown>
    if (Array.isArray(meta.files)) {
      // Files are checked by drift detection, not validation
    }
  }
}

function validateCompleteness(
  graph: KnowledgeGraph,
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  const hasProject = graph.nodes.some((n) => n.type === "project")
  if (!hasProject) {
    errors.push({ code: "NO_PROJECT_NODE", message: "Graph has no project node" })
  }

  const features = graph.nodes.filter((n) => n.type === "feature")
  if (features.length === 0) {
    warnings.push({
      code: "NO_FEATURES",
      message: "Graph has no feature nodes",
    })
  }

  const requirements = graph.nodes.filter((n) => n.type === "requirement")
  if (requirements.length === 0 && features.length > 0) {
    warnings.push({
      code: "FEATURES_NO_REQUIREMENTS",
      message: "Features exist but no requirements defined",
    })
  }

  // ── Cross-layer dependency validation ──────────────────────────────
  validateCrossLayerDependencies(graph, errors, warnings)

  // ── Deep semantic validation ───────────────────────────────────────
  validateSemanticDeep(graph, errors, warnings)
}

/**
 * Detect architecture violations: frontend files importing from backend packages,
 * database files importing from frontend, etc.
 */
function validateCrossLayerDependencies(
  graph: KnowledgeGraph,
  _errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  // Build layer map from architecture components
  const layerByModule = new Map<string, string>()
  const archNodes = graph.nodes.filter((n) => n.type === "architecture_component")
  for (const arch of archNodes) {
    const meta = arch.metadata as { layer?: string; technology?: string }
    if (meta.layer) {
      layerByModule.set(arch.id, meta.layer)
      // Also map by technology name
      if (meta.technology) {
        layerByModule.set(meta.technology.toLowerCase(), meta.layer)
      }
    }
  }

  // Build file→layer map from file metadata
  const fileLayerMap = new Map<string, string>()
  const fileNodes = graph.nodes.filter((n) => n.type === "file")
  for (const file of fileNodes) {
    const meta = file.metadata as { path?: string }
    if (!meta.path) continue
    const path = meta.path.toLowerCase()

    // Infer layer from path patterns
    if (path.includes("client") || path.includes("frontend") || path.includes("pages/") || path.includes("components/")) {
      fileLayerMap.set(file.id, "frontend")
    } else if (path.includes("server") || path.includes("backend") || path.includes("routes/") || path.includes("controllers/") || path.includes("services/") || path.includes("repositories/")) {
      fileLayerMap.set(file.id, "backend")
    } else if (path.includes("database") || path.includes("migrations/") || path.includes("schema")) {
      fileLayerMap.set(file.id, "database")
    } else if (path.includes("shared") || path.includes("common")) {
      fileLayerMap.set(file.id, "shared")
    }
  }

  // Check file→file dependencies for cross-layer imports
  const fileDeps = graph.relationships.filter(
    (r) => r.type === "uses" || r.type === "depends_on"
  )

  const LAYER_ORDER: Record<string, number> = {
    shared: 0,
    database: 1,
    backend: 2,
    frontend: 3,
    infrastructure: 4,
  }

  for (const dep of fileDeps) {
    const fromLayer = fileLayerMap.get(dep.from)
    const toLayer = fileLayerMap.get(dep.to)
    if (!fromLayer || !toLayer || fromLayer === toLayer || fromLayer === "shared" || toLayer === "shared") continue

    const fromOrder = LAYER_ORDER[fromLayer] ?? 2
    const toOrder = LAYER_ORDER[toLayer] ?? 2

    // Frontend importing from backend/database is a violation
    if (fromOrder > toOrder) {
      const fromNode = graph.nodes.find((n) => n.id === dep.from)
      const toNode = graph.nodes.find((n) => n.id === dep.to)
      warnings.push({
        code: "CROSS_LAYER_IMPORT",
        message: `${fromLayer} file "${fromNode?.name || dep.from}" imports from ${toLayer} file "${toNode?.name || dep.to}" — architecture violation`,
        node_id: dep.from,
      })
    }
  }

  // Also check symbol→symbol dependencies for cross-layer
  const symbolDeps = graph.relationships.filter(
    (r) => r.type === "calls" || r.type === "uses"
  )

  for (const dep of symbolDeps) {
    const fromSymbol = graph.nodes.find((n) => n.id === dep.from && n.type === "symbol")
    const toSymbol = graph.nodes.find((n) => n.id === dep.to && n.type === "symbol")
    if (!fromSymbol || !toSymbol) continue

    const fromMeta = fromSymbol.metadata as { file_path?: string }
    const toMeta = toSymbol.metadata as { file_path?: string }
    if (!fromMeta.file_path || !toMeta.file_path) continue

    // Infer layer from file path
    const fromPath = fromMeta.file_path.toLowerCase()
    const toPath = toMeta.file_path.toLowerCase()

    const fromIsFrontend = fromPath.includes("client") || fromPath.includes("frontend") || fromPath.includes("pages/") || fromPath.includes("components/")
    const toIsBackend = toPath.includes("server") || toPath.includes("backend") || toPath.includes("routes/") || toPath.includes("controllers/") || toPath.includes("services/") || toPath.includes("repositories/")
    const toIsDatabase = toPath.includes("database") || toPath.includes("migrations/") || toPath.includes("schema")

    if (fromIsFrontend && (toIsBackend || toIsDatabase)) {
      warnings.push({
        code: "CROSS_LAYER_IMPORT",
        message: `Frontend symbol "${fromSymbol.name}" (${fromMeta.file_path}) depends on ${toIsDatabase ? "database" : "backend"} symbol "${toSymbol.name}" (${toMeta.file_path}) — architecture violation`,
        node_id: dep.from,
      })
    }
  }
}

// ── Persistence mapping check (multiple strategies) ────────────────

/**
 * Check if an entity has a valid persistence mapping.
 * Supports multiple strategies:
 * 1. Relationship: persists_to → database/table node
 * 2. Metadata: metadata.table, tableName, stored_in, persists_in, uses, mapped_to
 * 3. Unified schema: entity has fields defined (acceptable for schema.sql patterns)
 */
export function hasPersistenceMapping(entity: any, graph: KnowledgeGraph): boolean {
  // Strategy 1: Explicit relationship
  const hasRel = graph.relationships.some(
    (r) => r.from === entity.id && r.type === "persists_to",
  )
  if (hasRel) return true

  // Strategy 2: Metadata fields indicating storage
  const meta = entity.metadata as Record<string, unknown>
  if (meta.table || meta.tableName || meta.stored_in || meta.persists_in || meta.uses || meta.mapped_to) {
    return true
  }

  // Strategy 3: Unified schema pattern — entity has fields defined
  // This is a legitimate architectural decision (e.g., schema.sql)
  const fields = (meta.fields as any[]) || []
  if (Array.isArray(fields) && fields.length > 0) {
    return true
  }

  return false
}

// ── Formatting ───────────────────────────────────────────────────────

/**
 * Deep semantic validation: checks meaning and intent, not just structure.
 */
function validateSemanticDeep(
  graph: KnowledgeGraph,
  _errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  // 1. Endpoint path params should match entity fields
  const endpoints = graph.nodes.filter(n => n.type === "endpoint")
  const entities = graph.nodes.filter(n => n.type === "entity")

  for (const endpoint of endpoints) {
    const meta = endpoint.metadata as { path?: string; method?: string }
    if (!meta.path) continue

    // Extract path params like :id, :userId
    const paramMatches = meta.path.matchAll(/:(\w+)/g)
    for (const match of paramMatches) {
      const paramName = match[1]
      // Check if any related entity has this field
      const relatedEntities = graph.relationships
        .filter(r => r.from === endpoint.id && r.type === "exposes")
        .map(r => graph.nodes.find(n => n.id === r.to))
        .filter(n => n?.type === "entity")

      if (relatedEntities.length > 0) {
        const hasField = relatedEntities.some(e => {
          const fields = (e!.metadata as any).fields || []
          return fields.some((f: any) => f.name === paramName)
        })
        if (!hasField) {
          warnings.push({
            code: "ENDPOINT_PARAM_MISMATCH",
            message: `Endpoint ${meta.method} ${meta.path} has param ":${paramName}" but no related entity has this field`,
            node_id: endpoint.id,
          })
        }
      }
    }
  }

  // 2. Features should connect to at least one requirement or endpoint
  const features = graph.nodes.filter(n => n.type === "feature")
  for (const feature of features) {
    const hasConnection = graph.relationships.some(
      r => (r.from === feature.id || r.to === feature.id) &&
        ["contains", "satisfied_by", "requires", "uses"].includes(r.type)
    )
    if (!hasConnection) {
      warnings.push({
        code: "FEATURE_NO_CONNECTIONS",
        message: `Feature "${feature.name}" has no relationships to requirements, endpoints, or entities`,
        node_id: feature.id,
      })
    }
  }

  // 3. Business rules should constrain something
  const rules = graph.nodes.filter(n => n.type === "business_rule")
  for (const rule of rules) {
    const constrainsSomething = graph.relationships.some(
      r => r.from === rule.id && r.type === "constrains"
    )
    if (!constrainsSomething) {
      warnings.push({
        code: "RULE_NO_TARGET",
        message: `Business rule "${rule.name}" doesn't constrain any feature or requirement`,
        node_id: rule.id,
      })
    }
  }

  // 4. Entities without fields
  for (const entity of entities) {
    const fields = (entity.metadata as any).fields || []
    if (fields.length === 0) {
      warnings.push({
        code: "ENTITY_NO_FIELDS",
        message: `Entity "${entity.name}" has no fields defined`,
        node_id: entity.id,
      })
    }
  }

  // 5. Requirements without acceptance criteria
  const reqs = graph.nodes.filter(n => n.type === "requirement")
  for (const req of reqs) {
    const meta = req.metadata as any
    if (!meta.acceptance_criteria || meta.acceptance_criteria.length === 0) {
      if (!req.description || req.description.length < 10) {
        warnings.push({
          code: "REQUIREMENT_NO_CRITERIA",
          message: `Requirement "${req.name}" has no acceptance criteria and minimal description`,
          node_id: req.id,
        })
      }
    }
  }
}

export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = []

  if (result.valid) {
    lines.push("✅ SDD Validation: PASSED\n")
  } else {
    lines.push("❌ SDD Validation: FAILED\n")
  }

  if (result.errors.length > 0) {
    lines.push(`### Errors (${result.errors.length})`)
    const errorsToShow = result.errors.slice(0, 20)
    for (const err of errorsToShow) {
      const nodeRef = err.node_id ? ` [${err.node_id}]` : ""
      lines.push(`- [${err.code}]${nodeRef} ${err.message}`)
    }
    if (result.errors.length > 20) {
      lines.push(`\n... and ${result.errors.length - 20} more errors`)
    }
    lines.push("")
  }

  if (result.warnings.length > 0) {
    lines.push(`### Warnings (${result.warnings.length})`)
    const warningsToShow = result.warnings.slice(0, 20)
    for (const warn of warningsToShow) {
      const nodeRef = warn.node_id ? ` [${warn.node_id}]` : ""
      lines.push(`- [${warn.code}]${nodeRef} ${warn.message}`)
    }
    if (result.warnings.length > 20) {
      lines.push(`\n... and ${result.warnings.length - 20} more warnings`)
    }
    lines.push("")
  }

  // Include integrity report if available
  if (result.integrity) {
    lines.push(formatIntegrityReport(result.integrity))
  }

  return lines.join("\n")
}
