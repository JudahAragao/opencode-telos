import type { KnowledgeGraph, ChangeNode, FeatureFlagNode } from '../domain/types.js';
export interface FeatureFlagWorkflow {
    id: string;
    flag_name: string;
    description: string;
    rollout_percentage: number;
    target_audience?: string;
}
export declare function createFeatureFlagChange(_graph: KnowledgeGraph, workflow: FeatureFlagWorkflow): {
    change: ChangeNode;
    featureFlag: FeatureFlagNode;
};
export declare function getFeatureFlagInstructions(featureFlag: FeatureFlagNode): string;
