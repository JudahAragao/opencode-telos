import type { KnowledgeGraph } from '../domain/types.js'

export interface OnboardingWorkflow {
  id: string
  developer_name?: string
}

export function generateOnboardingGuide(
  graph: KnowledgeGraph,
  workflow: OnboardingWorkflow
): string {
  const lines = [
    '## Guia de Onboarding',
    '',
  ]

  if (workflow.developer_name) {
    lines.push(`**Bem-vindo, ${workflow.developer_name}!**`, '')
  }

  lines.push(
    '### Project Overview',
    `**Total nodes:** ${graph.nodes.length}`,
    `**Total relationships:** ${graph.relationships.length}`,
    '',
    '### Key Files to Understand',
  )

  const nodesByType: Record<string, number> = {}
  for (const node of graph.nodes) {
    nodesByType[node.type] = (nodesByType[node.type] || 0) + 1
  }

  for (const [type, count] of Object.entries(nodesByType)) {
    lines.push(`- **${type}**: ${count} nodes`)
  }

  const features = graph.nodes.filter(n => n.type === 'feature')
  if (features.length > 0) {
    lines.push('', '### Features Principais')
    for (const feature of features.slice(0, 5)) {
      lines.push(`- ${feature.name}: ${feature.description || 'No description'}`)
    }
  }

  const endpoints = graph.nodes.filter(n => n.type === 'endpoint')
  if (endpoints.length > 0) {
    lines.push('', '### Endpoints da API')
    for (const endpoint of endpoints.slice(0, 5)) {
      const meta = endpoint.metadata as any
      lines.push(`- ${meta.method} ${meta.path}`)
    }
  }

  const decisions = graph.nodes.filter(n => n.type === 'decision')
  if (decisions.length > 0) {
    lines.push('', '### Important Architectural Decisions')
    for (const decision of decisions.slice(0, 3)) {
      const meta = decision.metadata as any
      lines.push(`- **${meta.title}**: ${meta.decision}`)
    }
  }

  lines.push(
    '',
    '### Primeiros Passos',
    '1. Read the feature nodes to understand what is being built',
    '2. Explore os endpoints da API',
    '3. Understand the architectural decisions',
    '4. Check for pending change requests',
    '',
    '### Comandos Úteis',
    '- `sdd.inspect` - View the current project state',
    '- `sdd.query_graph` - Consultar o Knowledge Graph',
    '- `sdd.validate` - Validate the specification',
    '',
    '### Precisa de Ajuda?',
    'Use `sdd.discover` to see common questions about the project.',
  )

  return lines.join('\n')
}