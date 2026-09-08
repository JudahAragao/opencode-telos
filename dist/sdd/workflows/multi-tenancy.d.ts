import type { KnowledgeGraph, ChangeNode, TenantNode } from '../domain/types.js';
export interface MultiTenancyWorkflow {
    id: string;
    tenant_name: string;
    tenant_type: 'shared_database' | 'dedicated_database' | 'shared_schema';
    isolation_level: 'row' | 'schema' | 'database';
}
export declare function createTenantChange(_graph: KnowledgeGraph, workflow: MultiTenancyWorkflow): {
    change: ChangeNode;
    tenant: TenantNode;
};
export declare function getTenantInstructions(tenant: TenantNode): string;
