import type { KnowledgeGraph } from '../domain/types.js';
export interface DisasterRecoveryPlan {
    rto: string;
    rpo: string;
    backup_strategy: string;
    failover_procedure: string[];
    recovery_steps: string[];
}
export declare function generateDisasterRecoveryPlan(_graph: KnowledgeGraph): DisasterRecoveryPlan;
export declare function formatDisasterRecoveryPlan(plan: DisasterRecoveryPlan): string;
