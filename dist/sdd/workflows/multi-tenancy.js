export function createTenantChange(_graph, workflow) {
    const changeId = `change-tenant-${Date.now()}`;
    const tenantId = `tenant-${Date.now()}`;
    const tenant = {
        id: tenantId,
        type: 'tenant',
        name: `Tenant: ${workflow.tenant_name}`,
        description: `Multi-tenancy setup for ${workflow.tenant_name}`,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            tenant_name: workflow.tenant_name,
            tenant_type: workflow.tenant_type,
            isolation_level: workflow.isolation_level,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const change = {
        id: changeId,
        type: 'change',
        name: `Multi-tenancy: ${workflow.tenant_name}`,
        description: `Add multi-tenancy for ${workflow.tenant_name}`,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            title: `Multi-tenancy: ${workflow.tenant_name}`,
            reason: `Add multi-tenancy for ${workflow.tenant_name}`,
            approval_level: 'APPROVAL',
            affected_nodes: [tenantId],
            affected_relationships: [],
            new_nodes: [tenantId],
            removed_nodes: [],
            modified_nodes: [],
            affected_files: [],
            affected_tests: [],
            implementation_tasks: [],
            origin: 'multi_tenancy_workflow',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    return { change, tenant };
}
export function getTenantInstructions(tenant) {
    const lines = [
        '## Multi-tenancy Workflow',
        '',
        `**Tenant:** ${tenant.metadata.tenant_name}`,
        `**Type:** ${tenant.metadata.tenant_type}`,
        `**Isolation:** ${tenant.metadata.isolation_level}`,
        '',
        '### Implementation Steps',
        '1. Add tenant_id to all entities',
        '2. Create tenant middleware',
        '3. Modify queries to filter by tenant',
        '4. Set up tenant context',
        '5. Test isolation between tenants',
        '',
        '### Security Considerations',
        '- Ensure data isolation',
        '- Validate tenant access',
        '- Prevent cross-tenant data leaks',
        '- Audit tenant operations',
    ];
    return lines.join('\n');
}
