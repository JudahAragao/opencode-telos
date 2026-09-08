import type { KnowledgeGraph } from '../domain/types.js';
export interface CostEstimate {
    infrastructure: Array<{
        service: string;
        cost: number;
        unit: string;
    }>;
    development: Array<{
        task: string;
        hours: number;
        rate: number;
    }>;
    total_infrastructure: number;
    total_development: number;
    total_monthly: number;
}
export interface CostEstimationOptions {
    /** Custom hourly rate (default: 50). */
    customRate?: number;
    /** Custom rates per task type. Overrides customRate for matching tasks. */
    customRates?: Record<string, number>;
    /** Only estimate costs for these areas: 'infrastructure' | 'development' | 'all'. */
    focusAreas?: 'infrastructure' | 'development' | 'all';
    /** Currency symbol (default: '$'). */
    currency?: string;
    /** Custom infrastructure costs. Key: service name. */
    customInfraCosts?: Record<string, number>;
}
export declare function estimateCost(graph: KnowledgeGraph, options?: CostEstimationOptions): CostEstimate;
export declare function formatCostEstimate(estimate: CostEstimate): string;
