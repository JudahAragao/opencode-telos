export function createDeprecationChange(_graph, workflow) {
    const changeId = `change-deprecate-${Date.now()}`;
    const deprecationId = `deprecate-${Date.now()}`;
    const deprecation = {
        id: deprecationId,
        type: 'deprecation',
        name: `Deprecation: ${workflow.target_feature}`,
        description: workflow.description,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            target_feature: workflow.target_feature,
            removal_date: workflow.removal_date,
            migration_guide: workflow.migration_guide,
            affected_endpoints: workflow.affected_endpoints,
            notification_sent: false,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const change = {
        id: changeId,
        type: 'change',
        name: `Deprecation: ${workflow.target_feature}`,
        description: workflow.description,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            title: `Deprecation: ${workflow.target_feature}`,
            reason: workflow.description,
            approval_level: 'APPROVAL',
            affected_nodes: [deprecationId],
            affected_relationships: [],
            new_nodes: [deprecationId],
            removed_nodes: [],
            modified_nodes: [],
            affected_files: [],
            affected_tests: [],
            implementation_tasks: [],
            origin: 'deprecation_workflow',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    return { change, deprecation };
}
export function getDeprecationInstructions(deprecation) {
    const lines = [
        '## Deprecation Workflow',
        '',
        `**Target:** ${deprecation.metadata.target_feature}`,
        `**Removal Date:** ${deprecation.metadata.removal_date}`,
        `**Affected Endpoints:** ${deprecation.metadata.affected_endpoints.join(', ')}`,
        '',
        '### Steps',
        '1. Find all usages of the feature',
        '2. Create migration guide',
        '3. Send notifications to affected users',
        '4. Add deprecation warnings',
        '5. Monitor usage',
        '6. Remove feature on removal date',
    ];
    if (deprecation.metadata.migration_guide) {
        lines.push('', '### Migration Guide', deprecation.metadata.migration_guide);
    }
    return lines.join('\n');
}
