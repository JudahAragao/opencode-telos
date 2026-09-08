import type { KnowledgeGraph, ChangeNode, ExperimentNode } from '../domain/types.js';
export interface ABTestingWorkflow {
    id: string;
    hypothesis: string;
    variants: Array<{
        name: string;
        description: string;
        traffic_percentage: number;
    }>;
    primary_metric: string;
    duration_days: number;
}
export declare function createExperimentChange(_graph: KnowledgeGraph, workflow: ABTestingWorkflow): {
    change: ChangeNode;
    experiment: ExperimentNode;
};
export declare function getExperimentInstructions(experiment: ExperimentNode): string;
