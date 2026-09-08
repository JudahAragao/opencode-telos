import type { KnowledgeGraph, ChangeNode, BugFixNode } from '../domain/types.js';
export interface BugFixWorkflow {
    id: string;
    description: string;
    files: string[];
    severity: 'critical' | 'high' | 'medium' | 'low';
}
export declare function createBugFixChange(_graph: KnowledgeGraph, workflow: BugFixWorkflow): {
    change: ChangeNode;
    bugFix: BugFixNode;
};
export declare function getBugFixInstructions(bugFix: BugFixNode): string;
