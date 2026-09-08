import type { KnowledgeGraph } from '../domain/types.js';
export interface OnboardingWorkflow {
    id: string;
    developer_name?: string;
}
export declare function generateOnboardingGuide(graph: KnowledgeGraph, workflow: OnboardingWorkflow): string;
