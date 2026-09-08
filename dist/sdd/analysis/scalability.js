export function analyzeScalability(graph) {
    const bottlenecks = [];
    const recommendations = [];
    const endpoints = graph.nodes.filter(n => n.type === 'endpoint');
    const entities = graph.nodes.filter(n => n.type === 'entity');
    for (const endpoint of endpoints) {
        const meta = endpoint.metadata;
        if (meta.method === 'GET' && meta.path.includes(':id')) {
            bottlenecks.push({
                type: 'n_plus_one_query',
                location: `${meta.method} ${meta.path}`,
                impact: 'medium',
                description: 'Endpoint de busca por ID pode ter problema N+1',
                recommendation: 'Implementar eager loading ou batch queries',
            });
        }
    }
    if (entities.length > 20) {
        bottlenecks.push({
            type: 'complex_data_model',
            location: 'Knowledge Graph',
            impact: 'medium',
            description: `${entities.length} entidades podem causar complexidade`,
            recommendation: 'Considerar particionamento ou caching',
        });
    }
    const databases = graph.nodes.filter(n => n.type === 'database');
    if (databases.length === 0 && entities.length > 5) {
        bottlenecks.push({
            type: 'missing_database',
            location: 'Arquitetura',
            impact: 'high',
            description: 'Sistema com muitas entidades sem banco de dados definido',
            recommendation: 'Definir estratégia de persistência',
        });
    }
    const score = Math.max(0, 100 - bottlenecks.length * 20);
    recommendations.push('Implementar caching para consultas frequentes');
    recommendations.push('Considerar índices para campos de busca');
    if (bottlenecks.length > 0) {
        recommendations.push('Revisar gargalos identificados');
    }
    return { bottlenecks, score, recommendations };
}
export function formatScalabilityAnalysis(result) {
    const lines = [
        '## Análise de Escalabilidade',
        '',
        `**Score:** ${result.score}/100`,
        `**Gargalos:** ${result.bottlenecks.length}`,
        '',
    ];
    if (result.bottlenecks.length > 0) {
        lines.push('### Gargalos Identificados');
        for (const bottleneck of result.bottlenecks) {
            lines.push(`#### ${bottleneck.type} (${bottleneck.impact})`);
            lines.push(`- **Local:** ${bottleneck.location}`);
            lines.push(`- **Descrição:** ${bottleneck.description}`);
            lines.push(`- **Recomendação:** ${bottleneck.recommendation}`);
            lines.push('');
        }
    }
    else {
        lines.push('✅ Nenhum gargalo crítico identificado');
    }
    lines.push('### Recomendações de Escalabilidade');
    for (const rec of result.recommendations) {
        lines.push(`- ${rec}`);
    }
    return lines.join('\n');
}
