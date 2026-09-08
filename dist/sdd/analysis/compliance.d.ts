import type { KnowledgeGraph } from '../domain/types.js';
export interface ComplianceCheckResult {
    standard: string;
    requirements: Array<{
        id: string;
        description: string;
        status: 'met' | 'partially_met' | 'not_met';
        evidence?: string;
        gap?: string;
    }>;
    score: number;
    recommendations: string[];
}
export interface ComplianceOptions {
    /** Custom compliance requirements to add alongside standard ones. */
    customStandards?: Array<{
        id: string;
        description: string;
        check: (graph: KnowledgeGraph) => 'met' | 'partially_met' | 'not_met';
    }>;
    /** Only check these specific requirement IDs. */
    focusRequirements?: string[];
    /** Skip these requirement IDs. */
    excludeChecks?: string[];
    /** Max requirements to evaluate. */
    maxRequirements?: number;
}
export declare function checkCompliance(_graph: KnowledgeGraph, standard: string, options?: ComplianceOptions): ComplianceCheckResult;
export declare function formatComplianceCheck(result: ComplianceCheckResult): string;
