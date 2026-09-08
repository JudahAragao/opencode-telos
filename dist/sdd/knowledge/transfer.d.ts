import type { KnowledgeGraph } from '../domain/types.js';
export interface KnowledgeTransferData {
    architectural_decisions: Array<{
        title: string;
        decision: string;
        context: string;
    }>;
    key_patterns: string[];
    common_issues: string[];
    critical_files: string[];
}
export interface KnowledgeTransferOptions {
    /** Only include decisions with these IDs. */
    focusDecisions?: string[];
    /** Max items per category (default: unlimited). */
    maxItems?: number;
    /** Only include these categories: 'decisions' | 'patterns' | 'issues' | 'files' | 'all'. */
    focusAreas?: 'decisions' | 'patterns' | 'issues' | 'files' | 'all';
    /** Custom filter for decisions (return true to include). */
    decisionFilter?: (decision: any) => boolean;
}
export declare function generateKnowledgeTransfer(graph: KnowledgeGraph, options?: KnowledgeTransferOptions): KnowledgeTransferData;
export declare function formatKnowledgeTransfer(data: KnowledgeTransferData): string;
