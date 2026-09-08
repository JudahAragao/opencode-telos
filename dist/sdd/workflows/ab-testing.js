export function createExperimentChange(_graph, workflow) {
    const changeId = `change-experiment-${Date.now()}`;
    const experimentId = `experiment-${Date.now()}`;
    const experiment = {
        id: experimentId,
        type: 'experiment',
        name: `Experiment: ${workflow.hypothesis}`,
        description: workflow.hypothesis,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            hypothesis: workflow.hypothesis,
            variants: workflow.variants,
            primary_metric: workflow.primary_metric,
            duration_days: workflow.duration_days,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const change = {
        id: changeId,
        type: 'change',
        name: `Experiment: ${workflow.hypothesis}`,
        description: workflow.hypothesis,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            title: `Experiment: ${workflow.hypothesis}`,
            reason: workflow.hypothesis,
            approval_level: 'REVIEW',
            affected_nodes: [experimentId],
            affected_relationships: [],
            new_nodes: [experimentId],
            removed_nodes: [],
            modified_nodes: [],
            affected_files: [],
            affected_tests: [],
            implementation_tasks: [],
            origin: 'ab_testing_workflow',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    return { change, experiment };
}
export function getExperimentInstructions(experiment) {
    const lines = [
        '## A/B Testing Workflow',
        '',
        `**Hypothesis:** ${experiment.metadata.hypothesis}`,
        `**Primary Metric:** ${experiment.metadata.primary_metric}`,
        `**Duration:** ${experiment.metadata.duration_days} days`,
        '',
        '### Variants',
        ...experiment.metadata.variants.map(v => `- **${v.name}**: ${v.description} (${v.traffic_percentage}% traffic)`),
        '',
        '### Steps',
        '1. Implement variant code',
        '2. Set up tracking for primary metric',
        '3. Split traffic according to percentages',
        '4. Monitor for statistical significance',
        '5. Analyze results after duration',
        '6. Implement winning variant',
    ];
    return lines.join('\n');
}
