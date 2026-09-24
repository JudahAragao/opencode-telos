import type { KnowledgeGraph, AnyNode } from "../domain/types.js"
import { addNode, addRelationship, getNode } from "../graph/engine.js"
import { ensureGraphIntegrity } from "../graph/integrity.js"
import { runRelationshipInference } from "./relationship-inferencer.js"
import { isRelationshipAllowed, normalizeRelationshipType } from "../graph/schema.js"
import { createTask, isTaskPriority } from "../tasks/board.js"
import type {
  BriefingDeepAnalysis,
  ExtractedFeature,
  ExtractedEntity,
  ExtractedEndpoint,
  ExtractedBusinessRule,
  ExtractedArchitectureComponent,
  ExtractedDecision,
  ExtractedRequirement,
  ExtractedTask,
} from "./briefing-analyzer.js"
import { progressEmitter } from "../../server/events.js"
import { createAcceptanceCriterion } from "../acceptance/service.js"

export interface GraphBuildResult {
  nodesCreated: number
  relationshipsCreated: number
  byType: Record<string, number>
  summary: string
}

function safeId(projectId: string, type: string, name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
  return `${projectId}-${type.toUpperCase().slice(0, 4)}-${clean}`
}

function now(): string {
  return new Date().toISOString()
}

// ─── Node Builders ─────────────────────────────────────────────────

function buildFeatureNodes(
  graph: KnowledgeGraph,
  features: ExtractedFeature[],
): number {
  let count = 0
  for (const f of features) {
    const id = safeId(graph.project_id, "feature", f.name)
    if (getNode(graph, id)) continue
    try {
      addNode(graph, {
        id,
        type: "feature",
        name: f.name,
        description: f.description,
        status: "DRAFT",
        version: 1,
        metadata: { priority: f.priority, phase: f.phase },
        created_at: now(),
        updated_at: now(),
      } as AnyNode)
      count++
    } catch { /* skip duplicates */ }
  }
  return count
}

function buildEntityNodes(
  graph: KnowledgeGraph,
  entities: ExtractedEntity[],
): number {
  let count = 0
  for (const e of entities) {
    const id = safeId(graph.project_id, "entity", e.name)
    if (getNode(graph, id)) continue
    try {
      addNode(graph, {
        id,
        type: "entity",
        name: e.name,
        description: e.description,
        status: "DRAFT",
        version: 1,
        metadata: { fields: e.fields },
        created_at: now(),
        updated_at: now(),
      } as AnyNode)
      count++
    } catch { /* skip */ }
  }
  return count
}

function buildEndpointNodes(
  graph: KnowledgeGraph,
  endpoints: ExtractedEndpoint[],
): number {
  let count = 0
  for (const ep of endpoints) {
    const id = safeId(graph.project_id, "endpoint", `${ep.method}-${ep.path}`)
    if (getNode(graph, id)) continue
    try {
      addNode(graph, {
        id,
        type: "endpoint",
        name: `${ep.method} ${ep.path}`,
        description: ep.description,
        status: "DRAFT",
        version: 1,
        metadata: {
          method: ep.method,
          path: ep.path,
          relatedEntity: ep.relatedEntity,
        },
        created_at: now(),
        updated_at: now(),
      } as AnyNode)
      count++
    } catch { /* skip */ }
  }
  return count
}

function buildBusinessRuleNodes(
  graph: KnowledgeGraph,
  rules: ExtractedBusinessRule[],
): number {
  let count = 0
  for (const r of rules) {
    const id = safeId(graph.project_id, "rule", r.name)
    if (getNode(graph, id)) continue
    try {
      addNode(graph, {
        id,
        type: "business_rule",
        name: r.name,
        description: r.description,
        status: "DRAFT",
        version: 1,
        metadata: { rule_text: r.description },
        created_at: now(),
        updated_at: now(),
      } as AnyNode)
      count++
    } catch { /* skip */ }
  }
  return count
}

function buildArchitectureNodes(
  graph: KnowledgeGraph,
  components: ExtractedArchitectureComponent[],
): number {
  let count = 0
  for (const c of components) {
    const id = safeId(graph.project_id, "arch", c.name)
    if (getNode(graph, id)) continue
    try {
      addNode(graph, {
        id,
        type: "architecture_component",
        name: c.name,
        description: c.description,
        status: "DRAFT",
        version: 1,
        metadata: { layer: c.layer, technology: c.technology },
        created_at: now(),
        updated_at: now(),
      } as AnyNode)
      count++
    } catch { /* skip */ }
  }
  return count
}

function buildDecisionNodes(
  graph: KnowledgeGraph,
  decisions: ExtractedDecision[],
): number {
  let count = 0
  for (const d of decisions) {
    const id = safeId(graph.project_id, "decision", d.title)
    if (getNode(graph, id)) continue
    try {
      addNode(graph, {
        id,
        type: "decision",
        name: d.title,
        description: d.context,
        status: "DRAFT",
        version: 1,
        metadata: {
          title: d.title,
          context: d.context,
          decision: d.decision,
          consequences: d.consequences,
        },
        created_at: now(),
        updated_at: now(),
      } as AnyNode)
      count++
    } catch { /* skip */ }
  }
  return count
}

function buildRequirementNodes(
  graph: KnowledgeGraph,
  requirements: ExtractedRequirement[],
): number {
  let count = 0
  for (const r of requirements) {
    const id = safeId(graph.project_id, "req", r.name)
    if (getNode(graph, id)) continue
    try {
      addNode(graph, {
        id,
        type: "requirement",
        name: r.name,
        description: r.description,
        status: "DRAFT",
        version: 1,
        metadata: {
          priority: r.priority,
          req_type: r.type,
        },
        created_at: now(),
        updated_at: now(),
      } as AnyNode)
      for (const criterion of r.acceptanceCriteria || []) {
        try { createAcceptanceCriterion(graph, id, criterion, "discovery") } catch { /* invalid criterion is reported by validation */ }
      }
      count++
    } catch { /* skip */ }
  }
  return count
}

function buildTaskNodes(
  graph: KnowledgeGraph,
  tasks: ExtractedTask[],
): { nodesCreated: number; relationshipsCreated: number } {
  let nodesCreated = 0
  let relationshipsCreated = 0

  for (const taskInput of tasks) {
    const name = taskInput.name.trim()
    if (!name) continue

    // Tasks are user-visible Kanban work items. Re-running a briefing must not
    // create a second card for the same work item.
    const existing = graph.nodes.find(
      (node) => node.type === "task" && node.name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) continue

    const targets = [taskInput.requirement, taskInput.feature]
      .map((reference) => reference ? resolveRelationshipEndpoint(graph, reference) : undefined)
      .filter((node): node is AnyNode => Boolean(node))
      .filter((node, index, all) => all.findIndex((candidate) => candidate.id === node.id) === index)

    let task: ReturnType<typeof createTask> | undefined
    try {
      task = createTask(graph, {
        name,
        description: taskInput.description,
        goal: taskInput.goal,
        files: taskInput.files,
        acceptance: taskInput.acceptance,
        priority: isTaskPriority(taskInput.priority) ? taskInput.priority : undefined,
        link_to: targets[0]?.id,
        link_type: targets[0] ? "implements" : undefined,
        origin: "briefing",
        integration_status: "pending",
      })
    } catch {
      // A manually created task may already have the same name. Treat that as
      // an idempotent bootstrap result rather than aborting the whole graph.
      continue
    }

    nodesCreated++
    if (targets.length > 0) relationshipsCreated++

    const metadata = task.metadata as Record<string, unknown>
    if (targets.some((target) => target.type === "requirement")) {
      metadata.requirement_id = targets.find((target) => target.type === "requirement")?.id
    }
    if (targets.some((target) => target.type === "feature")) {
      metadata.feature_id = targets.find((target) => target.type === "feature")?.id
    }
    if (taskInput.endpoint) metadata.endpoint_id = taskInput.endpoint

    // A task can implement both a requirement and its feature. The first target
    // is linked by createTask; add the remaining semantic links here.
    for (const target of targets.slice(1)) {
      try {
        addRelationship(graph, task.id, target.id, "implements", {
          method: "briefing-task-link",
          created_by: "graph-builder",
        })
        relationshipsCreated++
      } catch {
        // Invalid/duplicate links must not prevent the rest of the backlog.
      }
    }
  }

  return { nodesCreated, relationshipsCreated }
}

// ─── Declared relationships (from the LLM analysis) ────────────────

/**
 * Prefixos usados pelos extratores (`entity-Nome`, `feature-Nome`, …) mapeados
 * para o tipo curto que `safeId` usa, permitindo resolver a referência para o
 * ID real do grafo.
 */
const PREFIX_TO_SAFE_TYPE: Record<string, string> = {
  feature: "feature", feat: "feature",
  entity: "entity", ent: "entity",
  requirement: "requirement", req: "req",
  rule: "rule", business_rule: "rule", businessrule: "rule",
  arch: "arch", architecture: "arch", architecture_component: "arch",
  endpoint: "endpoint", ep: "endpoint",
}

/**
 * Resolve a referência de uma aresta declarada (ID real, ID prefixado do
 * extrator, ou nome do nó) para um nó existente no grafo.
 */
function resolveRelationshipEndpoint(
  graph: KnowledgeGraph,
  ref: string,
): AnyNode | undefined {
  if (!ref) return undefined

  const direct = getNode(graph, ref)
  if (direct) return direct

  const dashIndex = ref.indexOf("-")
  if (dashIndex > 0) {
    const prefix = ref.slice(0, dashIndex).toLowerCase()
    const rest = ref.slice(dashIndex + 1)
    const safeType = PREFIX_TO_SAFE_TYPE[prefix]
    if (safeType) {
      const node = getNode(graph, safeId(graph.project_id, safeType, rest))
      if (node) return node
    }
  }

  const lower = ref.toLowerCase()
  return graph.nodes.find((node) => node.name.toLowerCase() === lower)
}

/**
 * Aplica os relacionamentos declarados pela análise (LLM ou regex), validando
 * o tipo contra o schema canônico. Antes desta versão eles eram ignorados, o
 * que descartava silenciosamente a rastreabilidade extraída do briefing.
 */
function applyAnalysisRelationships(
  graph: KnowledgeGraph,
  analysis: BriefingDeepAnalysis,
): number {
  let count = 0
  for (const rel of analysis.relationships ?? []) {
    if (!rel?.from || !rel?.to) continue
    const type = normalizeRelationshipType(rel.type)
    if (!type) continue
    const from = resolveRelationshipEndpoint(graph, rel.from)
    const to = resolveRelationshipEndpoint(graph, rel.to)
    if (!from || !to || from.id === to.id) continue
    if (!isRelationshipAllowed(from.type, type, to.type)) continue
    try {
      addRelationship(graph, from.id, to.id, type, {
        inferred: true,
        method: "analysis-declared",
        confidence: 0.9,
        created_by: "graph-builder",
      })
      count++
    } catch {
      // Já existe ou criaria ciclo — a inferência cobre o que faltar.
    }
  }
  return count
}

// ─── Relationship Builder ──────────────────────────────────────────

function buildRelationships(
  graph: KnowledgeGraph,
  analysis: BriefingDeepAnalysis,
): number {
  let count = 0
  const projectId = graph.project_id

  // 1. Connect entities to database components
  const dbComponents = analysis.architectureComponents.filter((c) => c.layer === "database")
  for (const entity of analysis.entities) {
    const entityId = safeId(graph.project_id, "entity", entity.name)
    for (const db of dbComponents) {
      const dbId = safeId(graph.project_id, "arch", db.name)
      if (getNode(graph, entityId) && getNode(graph, dbId)) {
        try {
          addRelationship(graph, entityId, dbId, "persists_to")
          count++
        } catch { /* skip */ }
      }
    }
  }

  // 2. Connect endpoints to entities
  for (const ep of analysis.endpoints) {
    if (!ep.relatedEntity) continue
    const epId = safeId(graph.project_id, "endpoint", `${ep.method}-${ep.path}`)
    const entityId = safeId(graph.project_id, "entity", ep.relatedEntity)
    if (getNode(graph, epId) && getNode(graph, entityId)) {
      try {
        addRelationship(graph, epId, entityId, "exposes")
        count++
      } catch { /* skip */ }
    }
  }

  // 3. Connect features to architecture components
  for (const feature of analysis.features) {
    const featureId = safeId(graph.project_id, "feature", feature.name)
    // Connect to relevant architecture components
    for (const comp of analysis.architectureComponents) {
      const compId = safeId(graph.project_id, "arch", comp.name)
      if (getNode(graph, featureId) && getNode(graph, compId)) {
        // Features that mention the component name get connected
        if (
          feature.description.toLowerCase().includes(comp.name.toLowerCase()) ||
          feature.name.toLowerCase().includes(comp.name.toLowerCase())
        ) {
          try {
            addRelationship(graph, featureId, compId, "uses")
            count++
          } catch { /* skip */ }
        }
      }
    }
  }

  // 4. Connect features to entities
  for (const feature of analysis.features) {
    const featureId = safeId(graph.project_id, "feature", feature.name)
    for (const entity of analysis.entities) {
      const entityId = safeId(graph.project_id, "entity", entity.name)
      if (getNode(graph, featureId) && getNode(graph, entityId)) {
        if (
          feature.description.toLowerCase().includes(entity.name.toLowerCase()) ||
          feature.name.toLowerCase().includes(entity.name.toLowerCase())
        ) {
          try {
            addRelationship(graph, featureId, entityId, "uses")
            count++
          } catch { /* skip */ }
        }
      }
    }
  }

  // 5. Connect requirements to features (requirement --specifies--> feature)
  for (const req of analysis.requirements) {
    const reqId = safeId(graph.project_id, "req", req.name)
    for (const feature of analysis.features) {
      const featureId = safeId(graph.project_id, "feature", feature.name)
      if (getNode(graph, reqId) && getNode(graph, featureId)) {
        if (
          req.name.toLowerCase().includes(feature.name.toLowerCase()) ||
          feature.name.toLowerCase().includes(req.name.toLowerCase())
        ) {
          try {
            addRelationship(graph, reqId, featureId, "specifies")
            count++
          } catch { /* skip */ }
        }
      }
    }
  }

  // 6. Connect business rules to features
  for (const rule of analysis.businessRules) {
    const ruleId = safeId(graph.project_id, "rule", rule.name)
    for (const feature of analysis.features) {
      const featureId = safeId(graph.project_id, "feature", feature.name)
      if (getNode(graph, ruleId) && getNode(graph, featureId)) {
        if (
          rule.description.toLowerCase().includes(feature.name.toLowerCase()) ||
          feature.description.toLowerCase().includes(rule.name.toLowerCase())
        ) {
          try {
            addRelationship(graph, featureId, ruleId, "requires")
            count++
          } catch { /* skip */ }
        }
      }
    }
  }

  // 7. Connect architecture components to each other
  for (let i = 0; i < analysis.architectureComponents.length; i++) {
    for (let j = i + 1; j < analysis.architectureComponents.length; j++) {
      const a = analysis.architectureComponents[i]
      const b = analysis.architectureComponents[j]
      const aId = safeId(graph.project_id, "arch", a.name)
      const bId = safeId(graph.project_id, "arch", b.name)
      if (getNode(graph, aId) && getNode(graph, bId)) {
        // Frontend depends on backend, backend depends on database
        if (
          (a.layer === "frontend" && b.layer === "backend") ||
          (a.layer === "backend" && b.layer === "database")
        ) {
          try {
            addRelationship(graph, aId, bId, "depends_on")
            count++
          } catch { /* skip */ }
        }
        if (
          (b.layer === "frontend" && a.layer === "backend") ||
          (b.layer === "backend" && a.layer === "database")
        ) {
          try {
            addRelationship(graph, bId, aId, "depends_on")
            count++
          } catch { /* skip */ }
        }
      }
    }
  }

  // 8. Connect constitution to project root
  const constitutionId = `${graph.project_id}-CONSTITUTION`
  if (getNode(graph, constitutionId)) {
    try {
      addRelationship(graph, projectId, constitutionId, "validates")
      count++
    } catch { /* skip */ }
  }

  // 9. Connect decisions to related features/entities (not just to project root)
  for (const decision of analysis.decisions) {
    const decId = safeId(graph.project_id, "decision", decision.title)
    if (!getNode(graph, decId)) continue

    // Connect decision to features that share keywords
    for (const feature of analysis.features) {
      const featureId = safeId(graph.project_id, "feature", feature.name)
      if (!getNode(graph, featureId)) continue

      const decLower = decision.title.toLowerCase()
      const featLower = feature.name.toLowerCase()
      const featDescLower = feature.description.toLowerCase()

      if (
        decLower.includes(featLower) ||
        featLower.includes(decLower.split(" ")[0]) ||
        featDescLower.includes(decLower.split(" ")[0])
      ) {
        try {
          addRelationship(graph, decId, featureId, "influences")
          count++
        } catch { /* skip */ }
      }
    }

    // Connect decision to architecture components
    for (const comp of analysis.architectureComponents) {
      const compId = safeId(graph.project_id, "arch", comp.name)
      if (!getNode(graph, compId)) continue

      if (
        decision.title.toLowerCase().includes(comp.name.toLowerCase()) ||
        decision.context.toLowerCase().includes(comp.name.toLowerCase())
      ) {
        try {
          addRelationship(graph, decId, compId, "influences")
          count++
        } catch { /* skip */ }
      }
    }
  }

  // 10. Connect business rules to related requirements
  for (const rule of analysis.businessRules) {
    const ruleId = safeId(graph.project_id, "rule", rule.name)
    if (!getNode(graph, ruleId)) continue

    for (const req of analysis.requirements) {
      const reqId = safeId(graph.project_id, "req", req.name)
      if (!getNode(graph, reqId)) continue

      if (
        rule.description.toLowerCase().includes(req.name.toLowerCase().split(" ")[0]) ||
        req.name.toLowerCase().includes(rule.name.toLowerCase().split(" ")[0])
      ) {
        try {
          addRelationship(graph, ruleId, reqId, "constrains")
          count++
        } catch { /* skip */ }
      }
    }
  }

  // 11. Connect architecture components to business rules
  for (const comp of analysis.architectureComponents) {
    const compId = safeId(graph.project_id, "arch", comp.name)
    if (!getNode(graph, compId)) continue

    for (const rule of analysis.businessRules) {
      const ruleId = safeId(graph.project_id, "rule", rule.name)
      if (!getNode(graph, ruleId)) continue

      if (
        rule.description.toLowerCase().includes(comp.name.toLowerCase()) ||
        comp.description.toLowerCase().includes(rule.name.toLowerCase().split(" ")[0])
      ) {
        try {
          addRelationship(graph, ruleId, compId, "applies_to")
          count++
        } catch { /* skip */ }
      }
    }
  }

  // Note: Graph integrity (orphan connection, disconnected group merging,
  // redundant relationship cleanup) is handled by ensureGraphIntegrity()
  // called after buildRelationships in the main build function.

  return count
}

// ─── Main Build Function ───────────────────────────────────────────

export function buildGraphFromAnalysis(
  graph: KnowledgeGraph,
  analysis: BriefingDeepAnalysis,
): GraphBuildResult {
  const byType: Record<string, number> = {}
  const buildId = `build-${Date.now()}`

  // Define build steps for progress tracking
  const steps = [
    "features",
    "entities",
    "endpoints",
    "business_rules",
    "architecture",
    "decisions",
    "requirements",
    "tasks",
    "relationships",
    "connectivity",
  ]

  // Start build tracking
  progressEmitter.startBuild(buildId, steps)

  // Build all node types
  progressEmitter.nextStep("features", `Building feature nodes (${analysis.features.length} found)...`, buildId)
  byType.feature = buildFeatureNodes(graph, analysis.features)
  progressEmitter.stepProgress("features", `Created ${byType.feature} feature nodes`, undefined, buildId)

  progressEmitter.nextStep("entities", `Building entity nodes (${analysis.entities.length} found)...`, buildId)
  byType.entity = buildEntityNodes(graph, analysis.entities)
  progressEmitter.stepProgress("entities", `Created ${byType.entity} entity nodes`, undefined, buildId)

  progressEmitter.nextStep("endpoints", `Building endpoint nodes (${analysis.endpoints.length} found)...`, buildId)
  byType.endpoint = buildEndpointNodes(graph, analysis.endpoints)
  progressEmitter.stepProgress("endpoints", `Created ${byType.endpoint} endpoint nodes`, undefined, buildId)

  progressEmitter.nextStep("business_rules", `Building business rule nodes (${analysis.businessRules.length} found)...`, buildId)
  byType.business_rule = buildBusinessRuleNodes(graph, analysis.businessRules)
  progressEmitter.stepProgress("business_rules", `Created ${byType.business_rule} business rule nodes`, undefined, buildId)

  progressEmitter.nextStep("architecture", `Building architecture component nodes (${analysis.architectureComponents.length} found)...`, buildId)
  byType.architecture_component = buildArchitectureNodes(graph, analysis.architectureComponents)
  progressEmitter.stepProgress("architecture", `Created ${byType.architecture_component} architecture component nodes`, undefined, buildId)

  progressEmitter.nextStep("decisions", `Building decision nodes (${analysis.decisions.length} found)...`, buildId)
  byType.decision = buildDecisionNodes(graph, analysis.decisions)
  progressEmitter.stepProgress("decisions", `Created ${byType.decision} decision nodes`, undefined, buildId)

  progressEmitter.nextStep("requirements", `Building requirement nodes (${analysis.requirements.length} found)...`, buildId)
  byType.requirement = buildRequirementNodes(graph, analysis.requirements)
  progressEmitter.stepProgress("requirements", `Created ${byType.requirement} requirement nodes`, undefined, buildId)

  const taskInputs = analysis.tasks?.length
    ? analysis.tasks
    : analysis.requirements.length > 0
      ? analysis.requirements.map((requirement) => ({
        name: `Implement ${requirement.name}`,
        description: `Implement the behaviour specified by ${requirement.name}.`,
        goal: requirement.description,
        acceptance: requirement.acceptanceCriteria,
        priority: requirement.priority,
        requirement: requirement.name,
      }))
      : analysis.features.map((feature) => ({
        name: `Implement ${feature.name}`,
        description: `Implement the ${feature.name} capability.`,
        goal: feature.description,
        priority: feature.priority,
        feature: feature.name,
      }))
  progressEmitter.nextStep("tasks", `Building implementation tasks (${taskInputs.length} found)...`, buildId)
  const taskBuild = buildTaskNodes(graph, taskInputs)
  byType.task = taskBuild.nodesCreated
  progressEmitter.stepProgress("tasks", `Created ${byType.task} implementation tasks`, undefined, buildId)

  // Build relationships (includes orphan fallback)
  progressEmitter.nextStep("relationships", "Building relationships between nodes...", buildId)
  const relationshipsCreated = buildRelationships(graph, analysis)
  progressEmitter.stepProgress("relationships", `Created ${relationshipsCreated} relationships`, undefined, buildId)

  // Relacionamentos declarados pela análise do briefing (validados/normalizados)
  const declaredRelationships = applyAnalysisRelationships(graph, analysis)

  // Inferência de rastreabilidade: cobre os vínculos que a heurística por
  // keyword não alcança (endpoint/file --implements--> feature,
  // endpoint --operates_on--> entity, requirement --specifies--> feature).
  progressEmitter.nextStep("relationships", "Inferindo relacionamentos de rastreabilidade...", buildId)
  const inference = runRelationshipInference(graph)
  progressEmitter.stepProgress(
    "relationships",
    `Inference: ${inference.applied} edges applied, ${inference.normalized} normalized, ${inference.milestones_created} milestones`,
    undefined,
    buildId,
  )

  // Ensure full graph integrity: connect orphans, merge disconnected groups, clean redundancies
  progressEmitter.nextStep("connectivity", "Ensuring graph integrity...", buildId)
  const integrityReport = ensureGraphIntegrity(graph, { auto_fix: true })
  progressEmitter.stepProgress(
    "connectivity",
    `Integrity: ${integrityReport.summary.fixes_applied} fixes applied, ` +
    `${integrityReport.summary.orphans_found} orphans, ` +
    `${integrityReport.summary.disconnected_groups_found} disconnected groups`,
    undefined,
    buildId,
  )

  const nodesCreated = Object.values(byType).reduce((a, b) => a + b, 0)
  const totalRelationships =
    relationshipsCreated + taskBuild.relationshipsCreated + declaredRelationships + inference.applied
  const totalFixes = integrityReport.summary.fixes_applied

  // Complete build
  progressEmitter.complete(
    `Graph built: ${nodesCreated} nodes, ${totalRelationships} relationships, ${totalFixes} integrity fixes`,
    { nodesCreated, relationshipsCreated: totalRelationships, integrityReport, byType },
    buildId,
  )

  // Build summary
  const lines = [
    "## Graph Build Complete",
    "",
    `**Total nodes created:** ${nodesCreated}`,
    `**Total relationships created:** ${totalRelationships}`,
    `**Integrity fixes applied:** ${totalFixes}`,
    `**Graph connected:** ${integrityReport.summary.graph_connected ? "Yes" : "No"}`,
    "",
    "### Breakdown",
  ]

  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    if (count > 0) lines.push(`- **${type}:** ${count}`)
  }

  if (totalFixes > 0) {
    lines.push("")
    lines.push("### Integrity Fixes")
    for (const fix of integrityReport.fixes_applied.slice(0, 10)) {
      lines.push(`- ${fix.details}`)
    }
    if (integrityReport.fixes_applied.length > 10) {
      lines.push(`- ... and ${integrityReport.fixes_applied.length - 10} more`)
    }
  }

  lines.push("")
  lines.push("### Next Steps")
  lines.push("1. Run `sdd.validate` to check graph integrity")
  lines.push("2. Run `sdd.inspect` to see the complete graph")
  lines.push("3. Run `sdd.query_graph` to explore specific nodes")
  lines.push("4. Review and update node statuses as needed")

  return {
    nodesCreated,
    relationshipsCreated: totalRelationships,
    byType,
    summary: lines.join("\n"),
  }
}
