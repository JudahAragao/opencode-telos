import type { KnowledgeGraph, IncidentNode } from '../domain/types.js'

export interface IncidentWorkflow {
  id: string
  title: string
  severity: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'
  impact: string
}

export function createIncident(
  _graph: KnowledgeGraph,
  workflow: IncidentWorkflow
): IncidentNode {
  const incidentId = `incident-${Date.now()}`

  const incident: IncidentNode = {
    id: incidentId,
    type: 'incident',
    name: `Incidente: ${workflow.title}`,
    description: workflow.impact,
    status: 'PROPOSED',
    version: 1,
    metadata: {
      incident_title: workflow.title,
      severity: workflow.severity,
      status: 'open',
      impact: workflow.impact,
      timeline: [
        {
          timestamp: new Date().toISOString(),
          action: 'Incidente reportado',
          author: 'system',
        },
      ],
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  return incident
}

export function getIncidentInstructions(incident: IncidentNode): string {
  const lines = [
    '## Gestão de Incidente',
    '',
    `**Título:** ${incident.metadata.incident_title}`,
    `**Severidade:** ${incident.metadata.severity}`,
    `**Status:** ${incident.metadata.status}`,
    `**Impacto:** ${incident.metadata.impact}`,
    '',
    '### Procedimentos por Severidade',
    '',
    '**SEV1 (Crítico):**',
    '- Notificar stakeholders imediatamente',
    '- Ativar equipe de resposta a incidentes',
    '- Comunicação a cada 15 minutos',
    '',
    '**SEV2 (Alto):**',
    '- Notificar equipe responsável',
    '- Atualização a cada 30 minutos',
    '',
    '**SEV3 (Médio):**',
    '- Documentar e agendar correção',
    '- Atualização quando houver progresso',
    '',
    '**SEV4 (Baixo):**',
    '- Documentar para correção futura',
    '',
    '### Timeline',
  ]

  for (const entry of incident.metadata.timeline) {
    lines.push(`- ${entry.timestamp}: ${entry.action} (${entry.author})`)
  }

  lines.push(
    '',
    '### Próximos Passos',
    '1. Identificar causa raiz',
    '2. Implementar correção',
    '3. Verificar resolução',
    '4. Documentar lições aprendidas',
  )

  return lines.join('\n')
}