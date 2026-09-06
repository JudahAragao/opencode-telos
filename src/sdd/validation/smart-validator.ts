import type { KnowledgeGraph, AnyNode, NodeType, Relationship } from "../domain/types.js"
import { GraphIndices } from "../graph/index.js"
import {
  validateGraph,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
  type ValidationPolicy,
} from "./validator.js"
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js"
import { ValidationIndex } from "./coverage-index.js"

/**
 * Subsystem classification: which validation checks are relevant
 * for each node type.
 */
const SUBSYSTEM_MAP: Record<string, string[]> = {
  requirement: ["requirements", "semantic", "constitution"],
  business_rule: ["rules", "semantic", "constitution"],
  feature: ["features", "semantic"],
  entity: ["entities", "persistence", "cross-layer"],
  endpoint: ["endpoints", "api"],
  api: ["endpoints", "api"],
  architecture_component: ["architecture", "cross-layer"],
  file: ["files", "cross-layer"],
  symbol: ["files", "cross-layer"],
  task: ["requirements"],
  test: ["requirements"],
  database: ["persistence"],
  table: ["persistence"],
  change: ["features", "semantic"],
  constitution: ["constitution"],
  project: ["completeness"],
  domain: ["completeness"],
}

/**
 * Which validation subsystems exist and what they check.
 */
type ValidationSubsystem =
  | "requirements"
  | "features"
  | "entities"
  | "endpoints"
  | "api"
  | "architecture"
  | "cross-layer"
  | "persistence"
  | "files"
  | "semantic"
  | "constitution"
  | "completeness"
  | "structural"
  | "references"

/**
 * Map each subsystem to the node types it needs to check.
 */
const SUBSYSTEM_NODE_TYPES: Record<ValidationSubsystem, NodeType[]> = {
  requirements: ["requirement", "task", "test"],
  features: ["feature", "requirement", "change"],
  entities: ["entity", "field"],
  endpoints: ["endpoint"],
  api: ["api", "endpoint"],
  architecture: ["architecture_component"],
  "cross-layer": ["file", "symbol", "architecture_component"],
  persistence: ["entity", "table", "database"],
  files: ["file", "symbol"],
  semantic: ["requirement", "entity", "feature", "business_rule"],
  constitution: ["constitution", "requirement", "business_rule"],
  completeness: ["project", "feature", "requirement"],
  structural: [], // Always runs - checks all nodes
  references: [], // Always runs - checks all relationships
}

/**
 * Smart validation result with subsystem breakdown.
 */
export interface SmartValidationResult extends ValidationResult {
  subsystems_checked: string[]
  subsystems_skipped: string[]
  nodes_checked: number
  nodes_skipped: number
}

/**
 * Options for controlling smart validation scope.
 * The AI can use these to request additional subsystems or exclude specific ones.
 */
export interface SmartValidationOptions {
  /** Additional subsystems to validate beyond what was automatically detected. */
  additionalSubsystems?: ValidationSubsystem[]
  /** Subsystems to skip even if they were automatically detected. */
  excludeSubsystems?: ValidationSubsystem[]
  /** If true, validate ALL subsystems (ignore auto-detection). */
  validateAll?: boolean
  /** Maximum number of subsystems to validate (safety limit). */
  maxSubsystems?: number
  /** Shared validation index for coverage tracking across runs. */
  coverageIndex?: ValidationIndex
  /** Skip subsystems already verified in the coverage index. */
  skipVerified?: boolean
  /** Project-level severity policy for semantic validation. */
  policy?: ValidationPolicy
}

/**
 * Determine which subsystems are affected by a set of changed nodes.
 */
export function getAffectedSubsystems(
  dirtyNodeIds: Set<string>,
  indices: GraphIndices,
): { subsystems: Set<ValidationSubsystem>; nodeIds: Set<string> } {
  const subsystems = new Set<ValidationSubsystem>()
  const relevantNodeIds = new Set<string>()

  // Always check structural and references (cheap, global)
  subsystems.add("structural")
  subsystems.add("references")

  for (const nodeId of dirtyNodeIds) {
    const node = indices.byId.get(nodeId)
    if (!node) continue

    const nodeSubsystems = SUBSYSTEM_MAP[node.type] || []
    for (const sub of nodeSubsystems) {
      subsystems.add(sub as ValidationSubsystem)
    }

    // Also include adjacent nodes (1-hop) for cross-checks
    const outgoing = indices.getOutgoing(nodeId)
    const incoming = indices.getIncoming(nodeId)
    for (const rel of [...outgoing, ...incoming]) {
      relevantNodeIds.add(rel.from)
      relevantNodeIds.add(rel.to)
    }
    relevantNodeIds.add(nodeId)
  }

  return { subsystems, nodeIds: relevantNodeIds }
}

/**
 * Smart validation: only checks subsystems affected by the changed nodes.
 * Falls back to full validation if >50% of subsystems are affected.
 *
 * Uses GraphIndices for O(1) node lookups instead of O(n) array scans.
 */
export function validateSmart(
  graph: KnowledgeGraph,
  dirtyNodeIds: Set<string>,
  options?: SmartValidationOptions,
): SmartValidationResult {
  const indices = GraphIndices.from(graph)
  const allSubsystems = new Set<ValidationSubsystem>([
    "structural", "references", "requirements", "features", "entities",
    "endpoints", "api", "architecture", "cross-layer", "persistence",
    "files", "semantic", "constitution", "completeness",
  ])

  // A caller that has no reliable change set is asking for validation of the
  // current graph, not validation of an empty subset.  Treating it as an
  // incremental run used to produce successful validations without inspecting
  // a single node.
  if (dirtyNodeIds.size === 0 && !options?.additionalSubsystems && !options?.excludeSubsystems) {
    const fullResult = validateGraph(graph, options?.policy)
    const result: SmartValidationResult = {
      ...fullResult,
      subsystems_checked: [...allSubsystems],
      subsystems_skipped: [],
      nodes_checked: graph.nodes.length,
      nodes_skipped: 0,
    }
    if (options?.coverageIndex) options.coverageIndex.recordValidation(result)
    return result
  }

  // Auto-detect affected subsystems from dirty nodes
  const { subsystems: autoDetectedSubsystems, nodeIds: relevantNodeIds } =
    getAffectedSubsystems(dirtyNodeIds, indices)

  // Apply options: merge additional, exclude specific, or validate all
  let subsystemsToCheck = new Set<ValidationSubsystem>(autoDetectedSubsystems)

  if (options?.validateAll) {
    // IA requested: validate everything
    subsystemsToCheck = new Set(allSubsystems)
  } else {
    // Add additional subsystems requested by IA
    if (options?.additionalSubsystems) {
      for (const sub of options.additionalSubsystems) {
        subsystemsToCheck.add(sub)
      }
    }
    // Exclude subsystems the IA wants to skip
    if (options?.excludeSubsystems) {
      for (const sub of options.excludeSubsystems) {
        subsystemsToCheck.delete(sub)
      }
    }
  }

  // Skip already-verified subsystems if coverage index is provided
  if (options?.coverageIndex && options?.skipVerified) {
    for (const sub of options.coverageIndex.getVerifiedSubsystems()) {
      subsystemsToCheck.delete(sub as ValidationSubsystem)
    }
  }

  // Apply max limit if specified
  if (options?.maxSubsystems && subsystemsToCheck.size > options.maxSubsystems) {
    const arr = [...subsystemsToCheck].slice(0, options.maxSubsystems)
    subsystemsToCheck = new Set(arr)
  }

  // If >50% of subsystems affected, just do full validation (cheaper than smart)
  if (!options?.validateAll && subsystemsToCheck.size > allSubsystems.size * 0.5) {
    const fullResult = validateGraph(graph, options?.policy)
    return {
      ...fullResult,
      subsystems_checked: [...allSubsystems],
      subsystems_skipped: [],
      nodes_checked: graph.nodes.length,
      nodes_skipped: 0,
    }
  }

  const skippedSubsystems = [...allSubsystems].filter(
    (s) => !subsystemsToCheck.has(s),
  )

  // For the affected subsystems, run targeted checks
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []
  const { removed, deprecated } = getExclusionSets(graph)

  // Collect only nodes in relevant subsystems
  const relevantNodes = graph.nodes.filter((n) => relevantNodeIds.has(n.id))
  const relevantRels = graph.relationships.filter(
    (r) => relevantNodeIds.has(r.from) || relevantNodeIds.has(r.to),
  )

  // Subsystem-specific validation using indices
  for (const subsystem of subsystemsToCheck) {
    switch (subsystem) {
      case "requirements":
        validateRequirementsSmart(indices, relevantNodes, removed, deprecated, warnings)
        break
      case "entities":
        validateEntitiesSmart(indices, relevantNodes, removed, deprecated, warnings)
        break
      case "endpoints":
        validateEndpointsSmart(indices, relevantNodes, removed, deprecated, warnings)
        break
      case "cross-layer":
        validateCrossLayerSmart(indices, relevantNodes, relevantRels, warnings)
        break
      case "structural":
        validateStructuralSmart(relevantNodes, relevantRels, errors, warnings)
        break
      case "references":
        validateReferencesSmart(relevantNodes, relevantRels, graph, errors)
        break
    }
  }

  const result: SmartValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
    subsystems_checked: subsystemsToCheck.size > 0 ? [...subsystemsToCheck] : ["structural"],
    subsystems_skipped: skippedSubsystems,
    nodes_checked: relevantNodes.length,
    nodes_skipped: graph.nodes.length - relevantNodes.length,
  }

  // Record coverage in the index if provided
  if (options?.coverageIndex) {
    options.coverageIndex.recordValidation(result)
    // Record which specific nodes were checked
    for (const sub of result.subsystems_checked) {
      options.coverageIndex.recordNodesVerified(sub, relevantNodes.map(n => n.id))
    }
  }

  return result
}

// ── Smart subsystem validators (index-aware) ────────────────────────

function validateRequirementsSmart(
  indices: GraphIndices,
  nodes: AnyNode[],
  removed: Set<string>,
  deprecated: Set<string>,
  warnings: ValidationWarning[],
): void {
  const requirements = nodes.filter((n) => n.type === "requirement")
  for (const req of requirements) {
    if (isNodeExcludedOrDeprecated(req.id, req.status, removed, deprecated)) continue

    // O(1) check using index
    const outgoing = indices.getOutgoing(req.id)
    const hasTask = outgoing.some(
      (r) => r.type === "implemented_by" || r.type === "contains" || r.type === "belongs_to",
    )
    // VERIFIED requirements are already validated, skip warning
    if (!hasTask && req.status !== "VERIFIED") {
      warnings.push({
        code: "REQUIREMENT_NO_TASK",
        message: `Requirement ${req.id} has no implementing task`,
        node_id: req.id,
      })
    }

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

function validateEntitiesSmart(
  indices: GraphIndices,
  nodes: AnyNode[],
  removed: Set<string>,
  deprecated: Set<string>,
  warnings: ValidationWarning[],
): void {
  const entities = nodes.filter((n) => n.type === "entity")
  for (const entity of entities) {
    if (isNodeExcludedOrDeprecated(entity.id, entity.status, removed, deprecated)) continue

    const meta = entity.metadata as Record<string, unknown>
    const fields = (meta.fields as any[]) || []
    if (fields.length === 0) {
      warnings.push({
        code: "ENTITY_NO_FIELDS",
        message: `Entity "${entity.name}" has no fields defined`,
        node_id: entity.id,
      })
    }
  }
}

function validateEndpointsSmart(
  indices: GraphIndices,
  nodes: AnyNode[],
  removed: Set<string>,
  deprecated: Set<string>,
  warnings: ValidationWarning[],
): void {
  const endpoints = nodes.filter((n) => n.type === "endpoint")
  for (const ep of endpoints) {
    if (isNodeExcludedOrDeprecated(ep.id, ep.status, removed, deprecated)) continue

    const meta = ep.metadata as any
    if (!meta.method) warnings.push({ code: "ENDPOINT_NO_METHOD", message: `Endpoint ${ep.id} has no HTTP method`, node_id: ep.id })
    if (!meta.path) warnings.push({ code: "ENDPOINT_NO_PATH", message: `Endpoint ${ep.id} has no path`, node_id: ep.id })

    // O(1) check using index
    const incoming = indices.getIncoming(ep.id)
    const hasApi = incoming.some((r) => r.type === "contains")
    if (!hasApi) warnings.push({ code: "ENDPOINT_ORPHAN", message: `Endpoint ${ep.id} is not contained by any API`, node_id: ep.id })
  }
}

function validateCrossLayerSmart(
  indices: GraphIndices,
  nodes: AnyNode[],
  relationships: Relationship[],
  warnings: ValidationWarning[],
): void {
  const LAYER_ORDER: Record<string, number> = {
    shared: 0, database: 1, backend: 2, frontend: 3, infrastructure: 4,
  }

  function inferLayer(path: string): string | null {
    const p = path.toLowerCase()
    if (p.includes("client") || p.includes("frontend") || p.includes("pages/") || p.includes("components/")) return "frontend"
    if (p.includes("server") || p.includes("backend") || p.includes("routes/") || p.includes("services/")) return "backend"
    if (p.includes("database") || p.includes("migrations/") || p.includes("schema")) return "database"
    if (p.includes("shared") || p.includes("common")) return "shared"
    return null
  }

  const fileNodes = nodes.filter((n) => n.type === "file")
  const fileLayerMap = new Map<string, string>()
  for (const f of fileNodes) {
    const path = (f.metadata as any).path
    if (path) {
      const layer = inferLayer(path)
      if (layer) fileLayerMap.set(f.id, layer)
    }
  }

  for (const rel of relationships) {
    if (rel.type !== "uses" && rel.type !== "depends_on") continue
    const fromLayer = fileLayerMap.get(rel.from)
    const toLayer = fileLayerMap.get(rel.to)
    if (!fromLayer || !toLayer || fromLayer === toLayer || fromLayer === "shared" || toLayer === "shared") continue

    const fromOrder = LAYER_ORDER[fromLayer] ?? 2
    const toOrder = LAYER_ORDER[toLayer] ?? 2
    if (fromOrder > toOrder) {
      const fromNode = indices.byId.get(rel.from)
      const toNode = indices.byId.get(rel.to)
      warnings.push({
        code: "CROSS_LAYER_IMPORT",
        message: `${fromLayer} file "${fromNode?.name || rel.from}" imports from ${toLayer} file "${toNode?.name || rel.to}" — architecture violation`,
        node_id: rel.from,
      })
    }
  }
}

function validateStructuralSmart(
  nodes: AnyNode[],
  relationships: Relationship[],
  errors: ValidationError[],
  warnings: ValidationWarning[],
): void {
  const ids = new Set<string>()
  for (const rawNode of nodes) {
    const node = rawNode as { id?: string; type?: string; name?: string; status?: string }
    if (!node.id) {
      errors.push({ code: "MISSING_ID", message: "Node missing ID" })
      continue
    }
    if (ids.has(node.id)) {
      errors.push({ code: "DUPLICATE_ID", message: `Duplicate node ID: ${node.id}`, node_id: node.id })
    }
    ids.add(node.id)
    if (!node.type) errors.push({ code: "MISSING_TYPE", message: `Node ${node.id} missing type`, node_id: node.id })
    if (!node.name) warnings.push({ code: "MISSING_NAME", message: `Node ${node.id} missing name`, node_id: node.id })
    if (!node.status) warnings.push({ code: "MISSING_STATUS", message: `Node ${node.id} missing status`, node_id: node.id })
  }

  for (const rel of relationships) {
    if (!rel.from) errors.push({ code: "MISSING_RELATIONSHIP_FROM", message: `Relationship ${rel.id} missing 'from'`, relationship_id: rel.id })
    if (!rel.to) errors.push({ code: "MISSING_RELATIONSHIP_TO", message: `Relationship ${rel.id} missing 'to'`, relationship_id: rel.id })
    if (!rel.type) errors.push({ code: "MISSING_RELATIONSHIP_TYPE", message: `Relationship ${rel.id} missing type`, relationship_id: rel.id })
  }
}

function validateReferencesSmart(
  nodes: AnyNode[],
  relationships: Relationship[],
  graph: KnowledgeGraph,
  errors: ValidationError[],
): void {
  const nodeIds = new Set(nodes.map((n) => n.id))
  // Also include ALL node IDs for reference checking (a rel might reference outside the subset)
  const allNodeIds = new Set(graph.nodes.map((n) => n.id))

  for (const rel of relationships) {
    if (rel.from && !allNodeIds.has(rel.from)) {
      errors.push({ code: "DANGLING_REFERENCE", message: `Relationship ${rel.id} references non-existent source: ${rel.from}`, relationship_id: rel.id })
    }
    if (rel.to && !allNodeIds.has(rel.to)) {
      errors.push({ code: "DANGLING_REFERENCE", message: `Relationship ${rel.id} references non-existent target: ${rel.to}`, relationship_id: rel.id })
    }
  }
}
