export function createBugFixChange(_graph, workflow) {
    const changeId = `change-bugfix-${Date.now()}`;
    const bugFixId = `bugfix-${Date.now()}`;
    const bugFix = {
        id: bugFixId,
        type: 'bug_fix',
        name: `Bug Fix: ${workflow.description}`,
        description: workflow.description,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            bug_description: workflow.description,
            affected_files: workflow.files,
            severity: workflow.severity,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const change = {
        id: changeId,
        type: 'change',
        name: `Bug Fix: ${workflow.description}`,
        description: workflow.description,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            title: `Bug Fix: ${workflow.description}`,
            reason: workflow.description,
            approval_level: 'AUTO',
            affected_nodes: [bugFixId],
            affected_relationships: [],
            new_nodes: [bugFixId],
            removed_nodes: [],
            modified_nodes: [],
            affected_files: workflow.files,
            affected_tests: [],
            implementation_tasks: [],
            origin: 'bug_fix_workflow',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    return { change, bugFix };
}
export function getBugFixInstructions(bugFix) {
    const lines = [
        '## Bug Fix Workflow',
        '',
        `**Bug:** ${bugFix.metadata.bug_description}`,
        `**Severity:** ${bugFix.metadata.severity}`,
        `**Affected Files:** ${bugFix.metadata.affected_files.join(', ')}`,
        '',
        '### Steps',
        '1. Reproduce the bug',
        '2. Identify root cause',
        '3. Create fix',
        '4. Add tests to prevent regression',
        '5. Verify fix works',
        '',
        '### Auto-Approval',
        'Bug fixes are approved automatically (AUTO approval level).',
    ];
    return lines.join('\n');
}
