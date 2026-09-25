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
    '## Incident Management',
    '',
    `**Title:** ${incident.metadata.incident_title}`,
    `**Severidade:** ${incident.metadata.severity}`,
    `**Status:** ${incident.metadata.status}`,
    `**Impacto:** ${incident.metadata.impact}`,
    '',
    '### Procedimentos por Severidade',
    '',
    '**SEV1 (Critical):**',
    '- Notificar stakeholders imediatamente',
    '- Activate the incident response team',
    '- Communication every 15 minutes',
    '',
    '**SEV2 (Alto):**',
    '- Notify the responsible team',
    '- Update every 30 minutes',
    '',
    '**SEV3 (Medium):**',
    '- Document and schedule a fix',
    '- Update when there is progress',
    '',
    '**SEV4 (Baixo):**',
    '- Document for a future fix',
    '',
    '### Timeline',
  ]

  for (const entry of incident.metadata.timeline) {
    lines.push(`- ${entry.timestamp}: ${entry.action} (${entry.author})`)
  }

  lines.push(
    '',
    '### Next Steps',
    '1. Identificar causa raiz',
    '2. Implement the fix',
    '3. Verify the resolution',
    '4. Document the lessons learned',
  )

  return lines.join('\n')
}