/**
 * Canonical node relationship schema.
 *
 * Defines which relationships are REQUIRED, RECOMMENDED, or OPTIONAL for each
 * node type. This is the single source of truth for:
 *
 * 1. `ensureGraphIntegrity` — orphan detection rules per type (not just "no edges").
 * 2. Creation helpers — every node creation path can call `getRequiredRelationships(type)`
 *    to know what it must link IMMEDIATELY.
 * 3. LLM guidance — the system prompt can surface these rules so the agent
 *    knows what to pass as `parent_id` or extra IDs.
 *
 * KEY PRINCIPLE:
 * An orphan is not "a node with zero edges". An orphan is "a node that lacks
 * the REQUIRED semantic link for its type". A `task` node can be created with
 * only a `belongs_to → project` link (minimum) and later receive `implements`
 * — that is NOT an orphan. A `guidance` node with zero edges IS an orphan
 * because `guides` is always required.
 */

import type { NodeType, RelationshipType } from "../domain/types.js"

// ─── Requirement levels ────────────────────────────────────────────

export type RelationshipRequirement =
  /** Must exist before the node can be considered valid. */
  | "required"
  /**
   * Recommended. Missing it is a warning, not an error. The node is
   * structurally valid but semantically incomplete.
   */
  | "recommended"
  /** Optional. Nice to have but never triggers a warning. */
  | "optional"

// ─── Rule structures ───────────────────────────────────────────────

export interface NodeRelationshipRule {
  /**
   * Which direction this rule checks.
   * - `outgoing`: the node must have an outgoing edge of this type.
   * - `incoming`: the node must have an incoming edge of this type.
   * - `any`: either direction is fine.
   */
  direction: "outgoing" | "incoming" | "any"
  /** Relationship type this rule applies to. */
  type: RelationshipType
  /**
   * Acceptable partner node types. Empty / undefined means ANY type is fine.
   * Used for meaningful error messages, not enforcement.
   */
  partnerTypes?: NodeType[]
  /** Whether this rule is required, recommended, or optional. */
  level: RelationshipRequirement
  /** Human-readable rationale — shown in orphan warnings and system prompt. */
  rationale: string
  /**
   * When true, this rule is satisfied by an automatic fallback to the project
   * root (e.g. `project --contains--> node`). The fallback keeps the graph
   * connected but still triggers a "semantically incomplete" warning.
   */
  fallbackToProject?: boolean
}

export interface NodeTypeSchema {
  /** Node type this schema applies to. */
  nodeType: NodeType
  /** Whether a node of this type can be temporarily created with zero edges (orphan). */
  allowsTemporaryOrphan: boolean
  /** Rules that govern required/recommended relationships. */
  rules: NodeRelationshipRule[]
  /**
   * When a node has NO edges at all, what relationship should the auto-fix
   * create to make it minimally valid? `null` means "do not auto-fix — error instead".
   */
  minimumFallback: {
    relType: RelationshipType
    direction: "outgoing" | "incoming"
    partnerType: NodeType | "project_root"
  } | null
}

// ─── Schema map ───────────────────────────────────────────────────

/**
 * Full canonical schema. One entry per node type.
 * Types not listed here are treated as unrestricted (no rules).
 */
export const NODE_RELATIONSHIP_SCHEMA: NodeTypeSchema[] = [

  // ── project ──────────────────────────────────────────────────────
  {
    nodeType: "project",
    allowsTemporaryOrphan: true, // root node — no incoming relationship needed
    rules: [],
    minimumFallback: null,
  },

  // ── domain ───────────────────────────────────────────────────────
  {
    nodeType: "domain",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A domain must be contained by the project root. Without this link it floats as an island.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── feature ──────────────────────────────────────────────────────
  {
    nodeType: "feature",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "domain"],
        level: "required",
        rationale: "A feature must be contained by the project or a domain.",
        fallbackToProject: true,
      },
      {
        direction: "incoming",
        type: "specifies",
        partnerTypes: ["requirement"],
        level: "recommended",
        rationale: "Features should be backed by at least one requirement for traceability.",
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── requirement ──────────────────────────────────────────────────
  {
    nodeType: "requirement",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "any",
        type: "specifies",
        partnerTypes: ["feature"],
        level: "recommended",
        rationale: "A requirement should specify at least one feature to be traceable.",
      },
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "domain"],
        level: "required",
        rationale: "A requirement must be reachable from the project via contains.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── business_rule ─────────────────────────────────────────────────
  {
    nodeType: "business_rule",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "domain"],
        level: "required",
        rationale: "A business rule must be contained by the project or a domain.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── entity ────────────────────────────────────────────────────────
  {
    nodeType: "entity",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "domain"],
        level: "required",
        rationale: "An entity must be contained by the project or a domain.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── value_object ──────────────────────────────────────────────────
  {
    nodeType: "value_object",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "domain"],
        level: "required",
        rationale: "A value object must be contained by the project or a domain.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── actor ─────────────────────────────────────────────────────────
  {
    nodeType: "actor",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "An actor must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── use_case ─────────────────────────────────────────────────────
  {
    nodeType: "use_case",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "domain"],
        level: "required",
        rationale: "A use case must be contained by the project or domain.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── flow ─────────────────────────────────────────────────────────
  {
    nodeType: "flow",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "domain"],
        level: "required",
        rationale: "A flow must be contained by the project or domain.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── architecture_component ────────────────────────────────────────
  {
    nodeType: "architecture_component",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "An architecture component must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── database ─────────────────────────────────────────────────────
  {
    nodeType: "database",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A database must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── module ────────────────────────────────────────────────────────
  {
    nodeType: "module",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "architecture_component"],
        level: "required",
        rationale: "A module must be contained by the project or an architecture component.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── api ───────────────────────────────────────────────────────────
  {
    nodeType: "api",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "An API must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── endpoint ─────────────────────────────────────────────────────
  {
    nodeType: "endpoint",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "api"],
        level: "required",
        rationale: "An endpoint must be contained by the project or an API.",
        fallbackToProject: true,
      },
      {
        direction: "outgoing",
        type: "operates_on",
        partnerTypes: ["entity"],
        level: "recommended",
        rationale: "Endpoints should declare which entity they operate on for impact analysis.",
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── decision ─────────────────────────────────────────────────────
  {
    nodeType: "decision",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A decision (ADR) must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── constraint ────────────────────────────────────────────────────
  {
    nodeType: "constraint",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A constraint must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── assumption ────────────────────────────────────────────────────
  {
    nodeType: "assumption",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "An assumption must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── task ─────────────────────────────────────────────────────────
  {
    nodeType: "task",
    allowsTemporaryOrphan: true, // tasks start as pending integration
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "milestone"],
        level: "required",
        rationale: "A task must be contained by the project (minimum) or a milestone.",
        fallbackToProject: true,
      },
      {
        direction: "outgoing",
        type: "implements",
        partnerTypes: ["requirement", "feature"],
        level: "recommended",
        rationale: "Tasks should implement a requirement or feature (filled after integration).",
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── test ─────────────────────────────────────────────────────────
  {
    nodeType: "test",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project", "file"],
        level: "required",
        rationale: "A test must be contained by the project or a file.",
        fallbackToProject: true,
      },
      {
        direction: "outgoing",
        type: "tests",
        partnerTypes: ["requirement", "feature"],
        level: "recommended",
        rationale: "Tests should be linked to the requirement or feature they verify.",
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── file ─────────────────────────────────────────────────────────
  {
    nodeType: "file",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A file must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── symbol ────────────────────────────────────────────────────────
  {
    nodeType: "symbol",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["file"],
        level: "required",
        rationale: "A symbol must be contained by a file.",
        fallbackToProject: false,
      },
    ],
    minimumFallback: null, // symbols cannot be linked to project root — needs a file
  },

  // ── change ────────────────────────────────────────────────────────
  {
    nodeType: "change",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "outgoing",
        type: "affects",
        level: "required",
        rationale: "A change must affect at least one spec node. Without this, it cannot prove specification evidence.",
      },
    ],
    minimumFallback: null, // changes must explicitly declare scope — no project root fallback
  },

  // ── acceptance_criterion ──────────────────────────────────────────
  {
    nodeType: "acceptance_criterion",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "has_acceptance_criterion",
        partnerTypes: ["requirement"],
        level: "required",
        rationale: "An acceptance criterion must be linked to a requirement via has_acceptance_criterion.",
      },
    ],
    minimumFallback: null, // cannot link to project root — only makes sense with a requirement
  },

  // ── guidance ─────────────────────────────────────────────────────
  {
    nodeType: "guidance",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "outgoing",
        type: "guides",
        level: "required",
        rationale: "A guidance node must point to the node it instructs via guides.",
      },
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A guidance node must be contained by the project root.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: null, // both 'guides' and 'contains' must be set explicitly
  },

  // ── finding ──────────────────────────────────────────────────────
  {
    nodeType: "finding",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "outgoing",
        type: "detected_in",
        level: "required",
        rationale: "A finding must be detected_in at least one source (file, component, or project root).",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "detected_in", direction: "outgoing", partnerType: "project_root" },
  },

  // ── milestone ─────────────────────────────────────────────────────
  {
    nodeType: "milestone",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A milestone must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── migration ─────────────────────────────────────────────────────
  {
    nodeType: "migration",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A migration must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── experiment ────────────────────────────────────────────────────
  {
    nodeType: "experiment",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "An experiment must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── feature_flag ──────────────────────────────────────────────────
  {
    nodeType: "feature_flag",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A feature flag must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── tenant ────────────────────────────────────────────────────────
  {
    nodeType: "tenant",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A tenant must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── metric ────────────────────────────────────────────────────────
  {
    nodeType: "metric",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A metric must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── alert ─────────────────────────────────────────────────────────
  {
    nodeType: "alert",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "An alert must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── incident ──────────────────────────────────────────────────────
  {
    nodeType: "incident",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "An incident must be contained by the project.",
        fallbackToProject: true,
      },
      {
        direction: "outgoing",
        type: "incident_in",
        partnerTypes: ["architecture_component"],
        level: "recommended",
        rationale: "Incidents should reference the affected architecture component.",
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── sla ───────────────────────────────────────────────────────────
  {
    nodeType: "sla",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "An SLA must be contained by the project.",
        fallbackToProject: true,
      },
      {
        direction: "outgoing",
        type: "sla_for",
        partnerTypes: ["feature", "architecture_component"],
        level: "recommended",
        rationale: "SLAs should declare which feature or component they govern.",
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── bug_fix ───────────────────────────────────────────────────────
  {
    nodeType: "bug_fix",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A bug_fix must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── hotfix ────────────────────────────────────────────────────────
  {
    nodeType: "hotfix",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A hotfix must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── refactoring ───────────────────────────────────────────────────
  {
    nodeType: "refactoring",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A refactoring must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── deprecation ───────────────────────────────────────────────────
  {
    nodeType: "deprecation",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A deprecation must be contained by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "contains", direction: "incoming", partnerType: "project_root" },
  },

  // ── table ─────────────────────────────────────────────────────────
  {
    nodeType: "table",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["database"],
        level: "required",
        rationale: "A table must be contained by a database.",
        fallbackToProject: false,
      },
    ],
    minimumFallback: null, // tables need a database, not project root
  },

  // ── field ─────────────────────────────────────────────────────────
  {
    nodeType: "field",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "contains",
        partnerTypes: ["table", "entity"],
        level: "required",
        rationale: "A field must be contained by a table or entity.",
        fallbackToProject: false,
      },
    ],
    minimumFallback: null, // fields need a table or entity, not project root
  },

  // ── constitution ──────────────────────────────────────────────────
  {
    nodeType: "constitution",
    allowsTemporaryOrphan: false,
    rules: [
      {
        direction: "incoming",
        type: "validates",
        partnerTypes: ["project"],
        level: "required",
        rationale: "A constitution must be validated by the project.",
        fallbackToProject: true,
      },
    ],
    minimumFallback: { relType: "validates", direction: "incoming", partnerType: "project_root" },
  },
]

// ─── Index for fast lookups ────────────────────────────────────────

const SCHEMA_BY_NODE_TYPE = new Map<NodeType, NodeTypeSchema>()
for (const schema of NODE_RELATIONSHIP_SCHEMA) {
  SCHEMA_BY_NODE_TYPE.set(schema.nodeType, schema)
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Returns the schema for a given node type, or `null` if no rules are defined.
 */
export function getNodeTypeSchema(type: NodeType): NodeTypeSchema | null {
  return SCHEMA_BY_NODE_TYPE.get(type) ?? null
}

/**
 * Returns all required rules for a node type.
 */
export function getRequiredRules(type: NodeType): NodeRelationshipRule[] {
  return (SCHEMA_BY_NODE_TYPE.get(type)?.rules ?? []).filter((r) => r.level === "required")
}

/**
 * Returns all recommended rules for a node type.
 */
export function getRecommendedRules(type: NodeType): NodeRelationshipRule[] {
  return (SCHEMA_BY_NODE_TYPE.get(type)?.rules ?? []).filter((r) => r.level === "recommended")
}

/**
 * Returns the minimum fallback relationship for a node type when it has zero edges.
 * Returns `null` when no auto-fix is possible (e.g., symbol, table).
 */
export function getMinimumFallback(type: NodeType): NodeTypeSchema["minimumFallback"] {
  return SCHEMA_BY_NODE_TYPE.get(type)?.minimumFallback ?? null
}

/**
 * Returns whether a temporary orphan is allowed for a given node type.
 */
export function allowsTemporaryOrphan(type: NodeType): boolean {
  return SCHEMA_BY_NODE_TYPE.get(type)?.allowsTemporaryOrphan ?? true
}

export interface OrphanViolation {
  nodeId: string
  nodeName: string
  nodeType: NodeType
  missingRules: NodeRelationshipRule[]
  canAutoFix: boolean
}

/**
 * Checks a single node against its schema rules.
 *
 * @param nodeId    The node being checked.
 * @param nodeType  The type of the node.
 * @param nodeName  The name (for error messages).
 * @param outgoing  All outgoing relationship types from this node.
 * @param incoming  All incoming relationship types to this node.
 * @returns         An `OrphanViolation` if required rules are missing, else `null`.
 */
export function checkNodeOrphan(
  nodeId: string,
  nodeName: string,
  nodeType: NodeType,
  outgoing: Set<RelationshipType>,
  incoming: Set<RelationshipType>,
): OrphanViolation | null {
  const schema = SCHEMA_BY_NODE_TYPE.get(nodeType)
  if (!schema) return null // no rules → never an orphan

  const missingRequired: NodeRelationshipRule[] = []

  for (const rule of schema.rules) {
    if (rule.level !== "required") continue

    const satisfied = (() => {
      if (rule.direction === "outgoing") return outgoing.has(rule.type)
      if (rule.direction === "incoming") return incoming.has(rule.type)
      // "any": either direction
      return outgoing.has(rule.type) || incoming.has(rule.type)
    })()

    if (!satisfied) missingRequired.push(rule)
  }

  if (missingRequired.length === 0) return null

  const fallback = schema.minimumFallback
  return {
    nodeId,
    nodeName,
    nodeType,
    missingRules: missingRequired,
    canAutoFix: fallback !== null,
  }
}
