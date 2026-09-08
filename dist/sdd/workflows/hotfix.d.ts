import type { KnowledgeGraph, ChangeNode, HotfixNode } from '../domain/types.js';
export interface HotfixWorkflow {
    id: string;
    description: string;
    files: string[];
    urgency: 'critical' | 'high' | 'medium';
}
export declare function createHotfixChange(_graph: KnowledgeGraph, workflow: HotfixWorkflow): {
    change: ChangeNode;
    hotfix: HotfixNode;
};
export declare function getHotfixInstructions(hotfix: HotfixNode): string;
