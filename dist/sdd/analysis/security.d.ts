import type { KnowledgeGraph } from '../domain/types.js';
export interface SecurityAuditResult {
    vulnerabilities: Array<{
        type: string;
        severity: 'critical' | 'high' | 'medium' | 'low';
        location: string;
        description: string;
        recommendation: string;
    }>;
    score: number;
    recommendations: string[];
}
export interface SecurityAuditOptions {
    /** Only audit these specific endpoint IDs. */
    focusEndpoints?: string[];
    /** Only audit these specific entity IDs. */
    focusEntities?: string[];
    /** Minimum severity to include in results. */
    minSeverity?: 'critical' | 'high' | 'medium' | 'low';
    /** Max vulnerabilities to report. */
    maxVulnerabilities?: number;
}
export declare function performSecurityAudit(graph: KnowledgeGraph, options?: SecurityAuditOptions): SecurityAuditResult;
export declare function formatSecurityAudit(result: SecurityAuditResult): string;
