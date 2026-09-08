export function createMigrationChange(_graph, workflow) {
    const changeId = `change-migration-${Date.now()}`;
    const migrationId = `migration-${Date.now()}`;
    const migration = {
        id: migrationId,
        type: 'migration',
        name: `Migration: ${workflow.description}`,
        description: workflow.description,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            source_schema: workflow.source_schema,
            target_schema: workflow.target_schema,
            data_transformations: workflow.data_transformations,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const change = {
        id: changeId,
        type: 'change',
        name: `Migration: ${workflow.description}`,
        description: workflow.description,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            title: `Migration: ${workflow.description}`,
            reason: workflow.description,
            approval_level: 'APPROVAL',
            affected_nodes: [migrationId],
            affected_relationships: [],
            new_nodes: [migrationId],
            removed_nodes: [],
            modified_nodes: [],
            affected_files: [],
            affected_tests: [],
            implementation_tasks: [],
            origin: 'data_migration_workflow',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    return { change, migration };
}
export function getMigrationInstructions(migration) {
    const lines = [
        '## Data Migration Workflow',
        '',
        `**Source Schema:** ${migration.metadata.source_schema}`,
        `**Target Schema:** ${migration.metadata.target_schema}`,
        '',
        '### Steps',
        '1. Backup current data',
        '2. Analyze schema differences',
        '3. Generate migration script',
        '4. Test migration on staging',
        '5. Run migration on production',
        '6. Verify data integrity',
        '',
        '### Rollback',
        'Migration includes rollback script for emergency recovery.',
    ];
    if (migration.metadata.data_transformations) {
        lines.push('', '### Data Transformations', ...migration.metadata.data_transformations.map(t => `- ${t}`));
    }
    return lines.join('\n');
}
