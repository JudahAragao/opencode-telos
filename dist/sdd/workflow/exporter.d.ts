import type { KnowledgeGraph } from "../domain/types.js";
export interface WorkflowExport {
    project_id: string;
    exported_at: string;
    summary: {
        total_nodes: number;
        total_relationships: number;
        nodes_by_type: Record<string, number>;
        status_distribution: Record<string, number>;
    };
    changes: ChangeExport[];
    decisions: DecisionExport[];
    blockers: BlockerExport[];
    recommendations: string[];
}
export interface ChangeExport {
    id: string;
    status: string;
    title: string;
    created_at: string;
}
export interface DecisionExport {
    id: string;
    decision: string;
    rationale?: string;
    created_at: string;
}
export interface BlockerExport {
    node_id: string;
    node_type: string;
    name: string;
    reason: string;
}
export declare function exportWorkflow(graph: KnowledgeGraph): WorkflowExport;
export declare function formatWorkflowExport(exp: WorkflowExport): string;
