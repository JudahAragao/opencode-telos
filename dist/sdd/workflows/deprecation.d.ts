import type { KnowledgeGraph, ChangeNode, DeprecationNode } from '../domain/types.js';
export interface DeprecationWorkflow {
    id: string;
    target_feature: string;
    description: string;
    removal_date: string;
    migration_guide?: string;
    affected_endpoints: string[];
}
export declare function createDeprecationChange(_graph: KnowledgeGraph, workflow: DeprecationWorkflow): {
    change: ChangeNode;
    deprecation: DeprecationNode;
};
export declare function getDeprecationInstructions(deprecation: DeprecationNode): string;
