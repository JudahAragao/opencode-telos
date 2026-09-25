import type { KnowledgeGraph, SLANode } from '../domain/types.js'

export interface SLAWorkflow {
  id: string
  name: string
  metric: string
  target: number
  period: string
}

export function createSLA(
  _graph: KnowledgeGraph,
  workflow: SLAWorkflow
): SLANode {
  const slaId = `sla-${Date.now()}`

  const sla: SLANode = {
    id: slaId,
    type: 'sla',
    name: `SLA: ${workflow.name}`,
    description: `Service level agreement for ${workflow.metric}`,
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
  }

  return sla
}

export function getSLAInstructions(sla: SLANode): string {
  const lines = [
    '## SLA Configuration',
    '',
    `**Nome:** ${sla.metadata.sla_name}`,
    `**Metric:** ${sla.metadata.metric}`,
    `**Meta:** ${sla.metadata.target_value}`,
    `**Period:** ${sla.metadata.measurement_period}`,
    `**Status:** ${sla.metadata.status}`,
    '',
    '### Configuration',
    '1. Define the metric to monitor',
    '2. Establish the desired target',
    '3. Configure the measurement period',
    '4. Define actions for violations',
    '',
    '### Common Metrics',
    '- **Uptime:** Percentual de disponibilidade',
    '- **Latency:** Response time (p95, p99)',
    '- **Error rate:** Percentage of failed requests',
    '- **Throughput:** Requests per second',
    '',
    '### Actions for Violations',
    '- Notify the responsible owner',
    '- Iniciar post-mortem',
    '- Implement fixes',
    '- Update stakeholders',
  ]

  return lines.join('\n')
}