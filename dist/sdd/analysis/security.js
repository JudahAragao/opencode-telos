const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
export function performSecurityAudit(graph, options) {
    const vulnerabilities = [];
    const recommendations = [];
    const maxVulns = options?.maxVulnerabilities ?? Infinity;
    // Filter endpoints
    let endpoints = graph.nodes.filter(n => n.type === 'endpoint');
    if (options?.focusEndpoints?.length) {
        endpoints = endpoints.filter(e => options.focusEndpoints.includes(e.id));
    }
    for (const endpoint of endpoints) {
        if (vulnerabilities.length >= maxVulns)
            break;
        const meta = endpoint.metadata;
        if (meta.method === 'POST' || meta.method === 'PUT' || meta.method === 'DELETE') {
            const hasAuth = graph.relationships.some(r => r.from === endpoint.id && r.type === 'requires');
            if (!hasAuth) {
                const vuln = {
                    type: 'missing_authentication',
                    severity: 'high',
                    location: `${meta.method} ${meta.path}`,
                    description: 'Endpoint de modificação sem autenticação',
                    recommendation: 'Adicionar middleware de autenticação',
                };
                if (!options?.minSeverity || SEVERITY_ORDER[vuln.severity] <= SEVERITY_ORDER[options.minSeverity]) {
                    vulnerabilities.push(vuln);
                }
            }
        }
    }
    // Filter entities
    let entities = graph.nodes.filter(n => n.type === 'entity');
    if (options?.focusEntities?.length) {
        entities = entities.filter(e => options.focusEntities.includes(e.id));
    }
    for (const entity of entities) {
        if (vulnerabilities.length >= maxVulns)
            break;
        const fields = entity.metadata.fields || [];
        const sensitiveFields = fields.filter((f) => f.name.includes('password') ||
            f.name.includes('token') ||
            f.name.includes('secret'));
        if (sensitiveFields.length > 0) {
            const vuln = {
                type: 'sensitive_dataexposure',
                severity: 'medium',
                location: `Entity: ${entity.name}`,
                description: `Campos sensíveis detectados: ${sensitiveFields.map((f) => f.name).join(', ')}`,
                recommendation: 'Criptografar ou mascarar campos sensíveis',
            };
            if (!options?.minSeverity || SEVERITY_ORDER[vuln.severity] <= SEVERITY_ORDER[options.minSeverity]) {
                vulnerabilities.push(vuln);
            }
        }
    }
    const score = Math.max(0, 100 - vulnerabilities.length * 15);
    if (vulnerabilities.length === 0) {
        recommendations.push('Nenhuma vulnerabilidade crítica detectada');
    }
    else {
        recommendations.push('Corrigir vulnerabilidades antes de produção');
        recommendations.push('Implementar HTTPS em todos os endpoints');
        recommendations.push('Adicionar rate limiting');
    }
    return { vulnerabilities, score, recommendations };
}
export function formatSecurityAudit(result) {
    const lines = [
        '## Relatório de Auditoria de Segurança',
        '',
        `**Score:** ${result.score}/100`,
        `**Vulnerabilidades:** ${result.vulnerabilities.length}`,
        '',
    ];
    if (result.vulnerabilities.length > 0) {
        lines.push('### Vulnerabilidades Detectadas');
        for (const vuln of result.vulnerabilities) {
            lines.push(`#### ${vuln.type} (${vuln.severity})`);
            lines.push(`- **Local:** ${vuln.location}`);
            lines.push(`- **Descrição:** ${vuln.description}`);
            lines.push(`- **Recomendação:** ${vuln.recommendation}`);
            lines.push('');
        }
    }
    else {
        lines.push('✅ Nenhuma vulnerabilidade detectada');
    }
    lines.push('### Recomendações Gerais');
    for (const rec of result.recommendations) {
        lines.push(`- ${rec}`);
    }
    return lines.join('\n');
}
