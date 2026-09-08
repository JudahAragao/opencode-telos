export function createSLA(_graph, workflow) {
    const slaId = `sla-${Date.now()}`;
    const sla = {
        id: slaId,
        type: 'sla',
        name: `SLA: ${workflow.name}`,
        description: `Acordo de nível de serviço para ${workflow.metric}`,
        status: 'PROPOSED',
        version: 1,
        metadata: {
            sla_name: workflow.name,
            metric: workflow.metric,
            target_value: workflow.target,
            measurement_period: workflow.period,
            status: 'compliant',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    return sla;
}
export function getSLAInstructions(sla) {
    const lines = [
        '## Configuração de SLA',
        '',
        `**Nome:** ${sla.metadata.sla_name}`,
        `**Métrica:** ${sla.metadata.metric}`,
        `**Meta:** ${sla.metadata.target_value}`,
        `**Período:** ${sla.metadata.measurement_period}`,
        `**Status:** ${sla.metadata.status}`,
        '',
        '### Configuração',
        '1. Defina a métrica a ser monitorada',
        '2. Estabeleça a meta desejada',
        '3. Configure o período de medição',
        '4. Defina ações para violações',
        '',
        '### Métricas Comuns',
        '- **Uptime:** Percentual de disponibilidade',
        '- **Latência:** Tempo de resposta (p95, p99)',
        '- **Taxa de Erro:** Percentual de requisições com erro',
        '- **Throughput:** Requisições por segundo',
        '',
        '### Ações para Violações',
        '- Notificar responsável',
        '- Iniciar post-mortem',
        '- Implementar correções',
        '- Atualizar stakeholders',
    ];
    return lines.join('\n');
}
