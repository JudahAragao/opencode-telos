export function generateKnowledgeTransfer(graph, options) {
    const architectural_decisions = [];
    const key_patterns = [];
    const common_issues = [];
    const critical_files = [];
    const maxItems = options?.maxItems ?? Infinity;
    const focusAreas = options?.focusAreas ?? 'all';
    if (focusAreas === 'all' || focusAreas === 'decisions') {
        let decisions = graph.nodes.filter(n => n.type === 'decision');
        if (options?.focusDecisions?.length) {
            decisions = decisions.filter(d => options.focusDecisions.includes(d.id));
        }
        if (options?.decisionFilter) {
            decisions = decisions.filter(options.decisionFilter);
        }
        for (const decision of decisions.slice(0, maxItems)) {
            const meta = decision.metadata;
            architectural_decisions.push({
                title: meta.title,
                decision: meta.decision,
                context: meta.context,
            });
        }
    }
    if (focusAreas === 'all' || focusAreas === 'patterns') {
        const constraints = graph.nodes.filter(n => n.type === 'constraint');
        for (const constraint of constraints.slice(0, maxItems)) {
            const meta = constraint.metadata;
            key_patterns.push(`${meta.constraint_type}: ${meta.rule_text}`);
        }
    }
    if (focusAreas === 'all' || focusAreas === 'issues') {
        const antiPatterns = graph.nodes.filter(n => n.type === 'assumption');
        for (const assumption of antiPatterns.slice(0, maxItems)) {
            const meta = assumption.metadata;
            if (meta.requires_confirmation) {
                common_issues.push(`Assumpção não confirmada: ${meta.description}`);
            }
        }
    }
    if (focusAreas === 'all' || focusAreas === 'files') {
        const files = graph.nodes.filter(n => n.type === 'file');
        const criticalFiles = files.filter(f => {
            const incoming = graph.relationships.filter(r => r.to === f.id);
            return incoming.length > 3;
        });
        for (const file of criticalFiles.slice(0, Math.min(maxItems, 5))) {
            const meta = file.metadata;
            critical_files.push(meta.path);
        }
    }
    return {
        architectural_decisions,
        key_patterns,
        common_issues,
        critical_files,
    };
}
export function formatKnowledgeTransfer(data) {
    const lines = [
        '## Transferência de Conhecimento',
        '',
    ];
    if (data.architectural_decisions.length > 0) {
        lines.push('### Decisões Arquiteturais');
        for (const decision of data.architectural_decisions) {
            lines.push(`#### ${decision.title}`);
            lines.push(`- **Decisão:** ${decision.decision}`);
            lines.push(`- **Contexto:** ${decision.context}`);
            lines.push('');
        }
    }
    if (data.key_patterns.length > 0) {
        lines.push('### Padrões Principais');
        for (const pattern of data.key_patterns) {
            lines.push(`- ${pattern}`);
        }
    }
    if (data.common_issues.length > 0) {
        lines.push('', '### Problemas Comuns');
        for (const issue of data.common_issues) {
            lines.push(`- ${issue}`);
        }
    }
    if (data.critical_files.length > 0) {
        lines.push('', '### Arquivos Críticos');
        for (const file of data.critical_files) {
            lines.push(`- ${file}`);
        }
    }
    lines.push('', '### Próximos Passos', '1. Leia as decisões arquiteturais', '2. Entenda os padrões principais', '3. Verifique os problemas comuns', '4. Explore os arquivos críticos');
    return lines.join('\n');
}
