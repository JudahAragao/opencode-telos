export function createRefactoringChange(_graph, workflow) {
    const changeId = `change-refactor-${Date.now()}`;
    const refactoringId = `refactor-${Date.now()}`;
    const refactoring = {
        id: refactoringId,
        type: 'refactoring',
        name: `Refactoring: ${workflow.description}`,
        description: workflow.description,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            target_module: workflow.target_module,
            refactoring_type: workflow.refactoring_type,
            dependencies_affected: [],
            tests_required: true,
            backward_compatible: true,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const change = {
        id: changeId,
        type: 'change',
        name: `Refactoring: ${workflow.description}`,
        description: workflow.description,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            title: `Refactoring: ${workflow.description}`,
            reason: workflow.description,
            approval_level: 'REVIEW',
            affected_nodes: [refactoringId],
            affected_relationships: [],
            new_nodes: [refactoringId],
            removed_nodes: [],
            modified_nodes: [],
            affected_files: workflow.files,
            affected_tests: [],
            implementation_tasks: [],
            origin: 'refactoring_workflow',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    return { change, refactoring };
}
export function getRefactoringInstructions(refactoring) {
    const lines = [
        '## Refactoring Workflow',
        '',
        `**Target:** ${refactoring.metadata.target_module}`,
        `**Type:** ${refactoring.metadata.refactoring_type}`,
        `**Tests Required:** ${refactoring.metadata.tests_required ? 'Yes' : 'No'}`,
        `**Backward Compatible:** ${refactoring.metadata.backward_compatible ? 'Yes' : 'No'}`,
        '',
        '### Pre-Refactoring Checklist',
        '1. Verify tests exist for the target module',
        '2. Run existing tests to establish baseline',
        '3. Analyze dependencies',
        '',
        '### During Refactoring',
        '1. Make incremental changes',
        '2. Run tests after each change',
        '3. Commit frequently',
        '',
        '### Post-Refactoring',
        '1. Run full test suite',
        '2. Verify no regressions',
        '3. Update documentation if needed',
    ];
    return lines.join('\n');
}
