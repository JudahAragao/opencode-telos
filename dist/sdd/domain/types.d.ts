export type NodeStatus = "DRAFT" | "PROPOSED" | "APPROVED" | "IMPLEMENTING" | "IMPLEMENTED" | "VERIFIED" | "DEPRECATED" | "CONFLICT" | "DRIFTED" | "BLOCKED" | "todo" | "ready" | "in_progress" | "blocked" | "completed" | "VERIFYING" | "FAILED" | "ROLLED_BACK" | "COMPLETED";
export type ChangeStatus = NodeStatus;
export type TaskStatus = NodeStatus;
export type GapClassification = "CRITICAL" | "IMPORTANT" | "OPTIONAL" | "UNKNOWN";
export type ImpactLevel = "DIRECT" | "INDIRECT" | "POTENTIAL";
export type ApprovalLevel = "AUTO" | "REVIEW" | "APPROVAL" | "BLOCKED" | "POST_HOC";
export type NodeType = "project" | "domain" | "feature" | "requirement" | "business_rule" | "actor" | "entity" | "value_object" | "flow" | "use_case" | "architecture_component" | "module" | "api" | "endpoint" | "database" | "table" | "field" | "task" | "test" | "file" | "symbol" | "change" | "decision" | "constraint" | "assumption" | "constitution" | "bug_fix" | "hotfix" | "refactoring" | "deprecation" | "migration" | "experiment" | "feature_flag" | "tenant" | "metric" | "alert" | "incident" | "sla";
export type RelationshipType = "contains" | "depends_on" | "requires" | "implements" | "implemented_by" | "satisfied_by" | "affects" | "modifies" | "creates" | "deletes" | "uses" | "calls" | "persists_to" | "exposes" | "tested_by" | "tests" | "derived_from" | "contradicts" | "supersedes" | "replaces" | "blocked_by" | "belongs_to" | "owned_by" | "triggered_by" | "flows_to" | "deprecates" | "migrates_to" | "experimented_by" | "flagged_by" | "validates" | "influences" | "constrains" | "applies_to" | "owned_by_tenant" | "monitored_by" | "alerted_by" | "incident_in" | "sla_for" | "defines";
export interface Node {
    id: string;
    type: NodeType;
    name: string;
    description?: string;
    status: NodeStatus;
    version: number;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    created_by?: string;
    change_id?: string;
    previous_version?: number;
}
export interface Relationship {
    id: string;
    from: string;
    to: string;
    type: RelationshipType;
    metadata: Record<string, unknown>;
}
export interface ProjectNode extends Node {
    type: "project";
    metadata: {
        name: string;
        description?: string;
        stack?: string[];
    };
}
export interface DomainNode extends Node {
    type: "domain";
    metadata: {
        domain_name: string;
    };
}
export interface FeatureNode extends Node {
    type: "feature";
    metadata: {
        priority?: string;
    };
}
export interface RequirementNode extends Node {
    type: "requirement";
    metadata: {
        acceptance_criteria?: string[];
        priority?: string;
        evidence?: Array<{
            source: string;
            excerpt?: string;
            confidence?: number;
            confirmed?: boolean;
        }>;
        verification?: {
            scenarios?: Array<{
                given: string;
                when: string;
                then: string;
            }>;
            api_contract?: Record<string, unknown>;
            invariants?: string[];
            security_criteria?: string[];
            performance_criteria?: string[];
        };
    };
}
export interface BusinessRuleNode extends Node {
    type: "business_rule";
    metadata: {
        rule_text: string;
    };
}
export interface ActorNode extends Node {
    type: "actor";
    metadata: {
        actor_type: "user" | "system" | "external";
    };
}
export interface EntityNode extends Node {
    type: "entity";
    metadata: {
        fields?: Array<{
            name: string;
            type: string;
            required?: boolean;
            unique?: boolean;
        }>;
    };
}
export interface ValueObjectNode extends Node {
    type: "value_object";
    metadata: {
        fields?: Array<{
            name: string;
            type: string;
        }>;
    };
}
export interface FlowNode extends Node {
    type: "flow";
    metadata: {
        steps?: string[];
    };
}
export interface UseCaseNode extends Node {
    type: "use_case";
    metadata: {
        preconditions?: string[];
        postconditions?: string[];
    };
}
export interface ArchitectureComponentNode extends Node {
    type: "architecture_component";
    metadata: {
        layer: "frontend" | "backend" | "database" | "infrastructure" | "external";
        technology?: string;
    };
}
export interface ModuleNode extends Node {
    type: "module";
    metadata: {
        path: string;
    };
}
export interface ApiNode extends Node {
    type: "api";
    metadata: {
        base_path: string;
        version?: string;
    };
}
export interface EndpointNode extends Node {
    type: "endpoint";
    metadata: {
        method: string;
        path: string;
        request_body?: Record<string, unknown>;
        response_body?: Record<string, unknown>;
    };
}
export interface DatabaseNode extends Node {
    type: "database";
    metadata: {
        engine: string;
    };
}
export interface TableNode extends Node {
    type: "table";
    metadata: {
        table_name: string;
        fields?: Array<{
            name: string;
            type: string;
            primary_key?: boolean;
            foreign_key?: string;
        }>;
    };
}
export interface FieldNode extends Node {
    type: "field";
    metadata: {
        field_name: string;
        field_type: string;
    };
}
export interface TaskNode extends Node {
    type: "task";
    status: TaskStatus;
    metadata: {
        goal?: string;
        files?: string[];
        acceptance?: string[];
    };
}
export interface TestNode extends Node {
    type: "test";
    metadata: {
        test_type: "unit" | "integration" | "e2e";
        target?: string;
        /** Structured evidence for requirement aspects; never inferred from names. */
        covered_aspects?: string[];
        verifies?: string[];
    };
}
export interface FileNode extends Node {
    type: "file";
    metadata: {
        path: string;
        language?: string;
    };
}
export interface SymbolNode extends Node {
    type: "symbol";
    metadata: {
        symbol_type: "function" | "class" | "interface" | "type" | "method" | "variable" | "module" | "enum" | "field";
        file_path: string;
        line_start?: number;
        line_end?: number;
    };
}
export interface ChangeNode extends Node {
    type: "change";
    status: ChangeStatus;
    metadata: {
        title: string;
        reason: string;
        approval_level: ApprovalLevel;
        affected_nodes: string[];
        affected_relationships: string[];
        new_nodes: string[];
        removed_nodes: string[];
        modified_nodes: string[];
        affected_files: string[];
        affected_tests: string[];
        implementation_tasks: string[];
        origin?: string;
        transaction_id?: string;
        auto_archived?: boolean;
        archived_reason?: string;
    };
}
export interface DecisionNode extends Node {
    type: "decision";
    metadata: {
        title: string;
        context: string;
        decision: string;
        consequences?: string;
    };
}
export interface ConstraintNode extends Node {
    type: "constraint";
    metadata: {
        constraint_type: "technical" | "business" | "regulatory";
        rule_text: string;
    };
}
export interface AssumptionNode extends Node {
    type: "assumption";
    metadata: {
        description: string;
        source: string;
        confidence: "high" | "medium" | "low" | "explicit";
        requires_confirmation: boolean;
    };
}
export interface ConstitutionNode extends Node {
    type: "constitution";
    metadata: {
        principles: Array<{
            id: string;
            rule: string;
            severity: "must" | "should" | "may";
            scope?: string;
        }>;
        created_from?: string;
    };
}
export interface BugFixNode extends Node {
    type: "bug_fix";
    metadata: {
        bug_description: string;
        reproduction_steps?: string[];
        root_cause?: string;
        fix_description?: string;
        affected_files: string[];
        severity: "critical" | "high" | "medium" | "low";
    };
}
export interface HotfixNode extends Node {
    type: "hotfix";
    metadata: {
        incident_description: string;
        urgency: "critical" | "high" | "medium";
        fix_applied: boolean;
        post_hoc_documented: boolean;
        rollback_available: boolean;
    };
}
export interface RefactoringNode extends Node {
    type: "refactoring";
    metadata: {
        target_module: string;
        refactoring_type: "extract" | "rename" | "move" | "simplify" | "restructure";
        dependencies_affected: string[];
        tests_required: boolean;
        backward_compatible: boolean;
    };
}
export interface DeprecationNode extends Node {
    type: "deprecation";
    metadata: {
        target_feature: string;
        removal_date: string;
        migration_guide?: string;
        affected_endpoints: string[];
        notification_sent: boolean;
    };
}
export interface MigrationNode extends Node {
    type: "migration";
    metadata: {
        source_schema: string;
        target_schema: string;
        migration_script?: string;
        rollback_script?: string;
        data_transformations?: string[];
        estimated_duration?: string;
    };
}
export interface ExperimentNode extends Node {
    type: "experiment";
    metadata: {
        hypothesis: string;
        variants: Array<{
            name: string;
            description: string;
            traffic_percentage: number;
        }>;
        primary_metric: string;
        secondary_metrics?: string[];
        duration_days: number;
        min_sample_size?: number;
    };
}
export interface FeatureFlagNode extends Node {
    type: "feature_flag";
    metadata: {
        flag_name: string;
        description: string;
        enabled: boolean;
        rollout_percentage: number;
        target_audience?: string;
        kill_switch?: boolean;
    };
}
export interface TenantNode extends Node {
    type: "tenant";
    metadata: {
        tenant_name: string;
        tenant_type: "shared_database" | "dedicated_database" | "shared_schema";
        isolation_level: "row" | "schema" | "database";
        quotas?: Record<string, number>;
    };
}
export interface MetricNode extends Node {
    type: "metric";
    metadata: {
        metric_name: string;
        metric_type: "counter" | "gauge" | "histogram" | "summary";
        unit?: string;
        description: string;
        alert_threshold?: number;
    };
}
export interface AlertNode extends Node {
    type: "alert";
    metadata: {
        alert_name: string;
        condition: string;
        severity: "critical" | "warning" | "info";
        notification_channels: string[];
        cooldown_period?: string;
    };
}
export interface IncidentNode extends Node {
    type: "incident";
    metadata: {
        incident_title: string;
        severity: "SEV1" | "SEV2" | "SEV3" | "SEV4";
        status: "open" | "investigating" | "identified" | "monitoring" | "resolved";
        impact: string;
        timeline: Array<{
            timestamp: string;
            action: string;
            author: string;
        }>;
        root_cause?: string;
        resolution?: string;
    };
}
export interface SLANode extends Node {
    type: "sla";
    metadata: {
        sla_name: string;
        metric: string;
        target_value: number;
        current_value?: number;
        measurement_period: string;
        penalties?: string;
        status: "compliant" | "at_risk" | "violated";
    };
}
export interface SpecPromise {
    id: string;
    description: string;
    source_node_id: string;
    status: "pending" | "fulfilled" | "violated" | "unverifiable";
    evidence?: string;
    verified_at?: string;
}
export type AnyNode = ProjectNode | DomainNode | FeatureNode | RequirementNode | BusinessRuleNode | ActorNode | EntityNode | ValueObjectNode | FlowNode | UseCaseNode | ArchitectureComponentNode | ModuleNode | ApiNode | EndpointNode | DatabaseNode | TableNode | FieldNode | TaskNode | TestNode | FileNode | SymbolNode | ChangeNode | DecisionNode | ConstraintNode | AssumptionNode | ConstitutionNode | BugFixNode | HotfixNode | RefactoringNode | DeprecationNode | MigrationNode | ExperimentNode | FeatureFlagNode | TenantNode | MetricNode | AlertNode | IncidentNode | SLANode;
export interface KnowledgeGraph {
    version: string;
    project_id: string;
    nodes: AnyNode[];
    relationships: Relationship[];
    metadata: {
        created_at: string;
        updated_at: string;
        sdd_version: string;
    };
}
export interface Transaction {
    id: string;
    change_id: string;
    status: "PLANNED" | "SPEC_UPDATED" | "IMPLEMENTING" | "IMPLEMENTED" | "VERIFYING" | "COMPLETED" | "FAILED" | "ROLLED_BACK";
    specification_changes: string[];
    code_changes: string[];
    test_changes: string[];
    graph_changes: string[];
    created_at: string;
    updated_at: string;
}
export interface Snapshot {
    id: string;
    timestamp: string;
    description: string;
    graph_state: KnowledgeGraph;
}
export interface SddConfig {
    storage: "yaml" | "json";
    dashboard: {
        enabled: boolean;
        host: string;
        port: "auto" | number;
    };
    workflow: {
        specification_first: boolean;
        auto_discovery: boolean;
        drift_detection: boolean;
        require_approval_for_architecture_changes: boolean;
    };
    graph: {
        max_traversal_depth: number;
    };
    git: {
        enabled: boolean;
    };
    validation: {
        critical_requirement_without_test: "error" | "warning";
        missing_verification_scenario: "error" | "warning";
    };
}
export declare const DEFAULT_SDD_CONFIG: SddConfig;
