export function generateOnboardingGuide(graph, workflow) {
    const lines = [
        '## Guia de Onboarding',
        '',
    ];
    if (workflow.developer_name) {
        lines.push(`**Bem-vindo, ${workflow.developer_name}!**`, '');
    }
    lines.push('### Visão Geral do Projeto', `**Total de Nós:** ${graph.nodes.length}`, `**Total de Relações:** ${graph.relationships.length}`, '', '### Arquivos-Chave para Entender');
    const nodesByType = {};
    for (const node of graph.nodes) {
        nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
    }
    for (const [type, count] of Object.entries(nodesByType)) {
        lines.push(`- **${type}**: ${count} nós`);
    }
    const features = graph.nodes.filter(n => n.type === 'feature');
    if (features.length > 0) {
        lines.push('', '### Features Principais');
        for (const feature of features.slice(0, 5)) {
            lines.push(`- ${feature.name}: ${feature.description || 'Sem descrição'}`);
        }
    }
    const endpoints = graph.nodes.filter(n => n.type === 'endpoint');
    if (endpoints.length > 0) {
        lines.push('', '### Endpoints da API');
        for (const endpoint of endpoints.slice(0, 5)) {
            const meta = endpoint.metadata;
            lines.push(`- ${meta.method} ${meta.path}`);
        }
    }
    const decisions = graph.nodes.filter(n => n.type === 'decision');
    if (decisions.length > 0) {
        lines.push('', '### Decisões Arquiteturais Importantes');
        for (const decision of decisions.slice(0, 3)) {
            const meta = decision.metadata;
            lines.push(`- **${meta.title}**: ${meta.decision}`);
        }
    }
    lines.push('', '### Primeiros Passos', '1. Leia os nodes de feature para entender o que está sendo construído', '2. Explore os endpoints da API', '3. Entenda as decisões arquiteturais', '4. Verifique se há change requests pendentes', '', '### Comandos Úteis', '- `sdd.inspect` - Ver estado atual do projeto', '- `sdd.query_graph` - Consultar o Knowledge Graph', '- `sdd.validate` - Validar a especificação', '', '### Precisa de Ajuda?', 'Use `sdd.discover` para ver perguntas frequentes sobre o projeto.');
    return lines.join('\n');
}
