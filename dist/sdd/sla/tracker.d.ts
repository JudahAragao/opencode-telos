import type { KnowledgeGraph, SLANode } from '../domain/types.js';
export interface SLAWorkflow {
    id: string;
    name: string;
    metric: string;
    target: number;
    period: string;
}
export declare function createSLA(_graph: KnowledgeGraph, workflow: SLAWorkflow): SLANode;
export declare function getSLAInstructions(sla: SLANode): string;
