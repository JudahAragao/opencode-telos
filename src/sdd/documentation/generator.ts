import type { KnowledgeGraph } from '../domain/types.js'

export interface DocumentationConfig {
  type: 'api' | 'user_guide' | 'developer_guide' | 'architecture'
  language?: string
}

export function generateDocumentation(
  graph: KnowledgeGraph,
  config: DocumentationConfig
): string {
  let document: string
  if (config.type === 'api') {
    document = generateAPIDocumentation(graph)
  } else if (config.type === 'user_guide') {
    document = generateUserGuide(graph)
  } else if (config.type === 'developer_guide') {
    document = generateDeveloperGuide(graph)
  } else {
    document = generateArchitectureDoc(graph)
  }
  return `${document}\n\n${generateFindingsSection(graph)}`
}

function generateFindingsSection(graph: KnowledgeGraph): string {
  const findings = graph.nodes.filter((node) => node.type === 'finding')
  const open = findings.filter((node) => !['resolved', 'closed', 'wont_fix'].includes(node.status))
  const resolved = findings.filter((node) => ['resolved', 'closed', 'wont_fix'].includes(node.status))
  const lines = [
    '## Findings, Risks and Resolutions',
    '',
    'This section records problems observed in the documented system. `APPROVED` means the behaviour was confirmed in the AS-IS; it does not mean it is correct.',
    '',
    `- Descobertas abertas: ${open.length}`,
    `- Descobertas resolvidas ou aceitas: ${resolved.length}`,
  ]
  for (const node of findings) {
    const meta = node.metadata as Record<string, any>
    lines.push('', `### ${node.id} — ${meta.title ?? node.name}`, `- Status: ${node.status}`, `- Severidade: ${meta.severity ?? 'unknown'}`, `- Categoria: ${meta.category ?? 'unknown'}`, `- Observado: ${meta.observed_behavior ?? node.description ?? ''}`)
    if (meta.expected_behavior) lines.push(`- Esperado: ${meta.expected_behavior}`)
    if (meta.resolution?.description) lines.push(`- Resolution: ${meta.resolution.description}`)
  }
  if (findings.length === 0) lines.push('',    'No finding was recorded.')
  return lines.join('\n')
}

function generateAPIDocumentation(graph: KnowledgeGraph): string {
  const lines = [
    '# API Documentation',
    '',
    '## Endpoints',
    '',
  ]

  const endpoints = graph.nodes.filter(n => n.type === 'endpoint')
  
  for (const endpoint of endpoints) {
    const meta = endpoint.metadata as any
    lines.push(`### ${meta.method} ${meta.path}`)
    lines.push('')
    
    if (meta.request_body) {
      lines.push('**Request Body:**')
      lines.push('```json')
      lines.push(JSON.stringify(meta.request_body, null, 2))
      lines.push('```')
    }
    
    if (meta.response_body) {
      lines.push('**Response Body:**')
      lines.push('```json')
      lines.push(JSON.stringify(meta.response_body, null, 2))
      lines.push('```')
    }
    
    lines.push('')
  }

  return lines.join('\n')
}

function generateUserGuide(graph: KnowledgeGraph): string {
  const lines = [
    '# User Guide',
    '',
    '## Overview',
    '',
  ]

  const features = graph.nodes.filter(n => n.type === 'feature')
  
  if (features.length > 0) {
    lines.push('### Available Features')
    for (const feature of features) {
      lines.push(`- **${feature.name}**: ${feature.description || 'No description'}`)
    }
  }

  const useCases = graph.nodes.filter(n => n.type === 'use_case')
  
  if (useCases.length > 0) {
    lines.push('', '### Casos de Uso')
    for (const useCase of useCases) {
      lines.push(`- **${useCase.name}**: ${useCase.description || 'No description'}`)
    }
  }

  return lines.join('\n')
}

function generateDeveloperGuide(graph: KnowledgeGraph): string {
  const lines = [
    '# Guia do Desenvolvedor',
    '',
    '## Project Structure',
    '',
  ]

  const modules = graph.nodes.filter(n => n.type === 'module')
  
  if (modules.length > 0) {
    lines.push('### Modules')
    for (const module of modules) {
      const meta = module.metadata as any
      lines.push(`- **${module.name}**: ${meta.path}`)
    }
  }

  const entities = graph.nodes.filter(n => n.type === 'entity')
  
  if (entities.length > 0) {
    lines.push('', '### Entidades')
    for (const entity of entities) {
      const fields = (entity.metadata as any).fields || []
      lines.push(`- **${entity.name}**: ${fields.map((f: any) => f.name).join(', ')}`)
    }
  }

  lines.push(
    '',
    '## Desenvolvimento',
    '1. Clone the repository',
    '2. Install the dependencies',
    '3. Execute os testes',
    '4. Siga o workflow SDD',
  )

  return lines.join('\n')
}

function generateArchitectureDoc(graph: KnowledgeGraph): string {
  const lines = [
    '# Architecture Documentation',
    '',
    '## Overview',
    `**Total nodes:** ${graph.nodes.length}`,
    `**Total relationships:** ${graph.relationships.length}`,
    '',
  ]

  const components = graph.nodes.filter(n => n.type === 'architecture_component')
  
  if (components.length > 0) {
    lines.push('### Componentes')
    for (const component of components) {
      const meta = component.metadata as any
      lines.push(`- **${component.name}** (${meta.layer}): ${meta.technology || 'Not defined'}`)
    }
  }

  const decisions = graph.nodes.filter(n => n.type === 'decision')
  
  if (decisions.length > 0) {
    lines.push('', '### Architectural Decisions')
    for (const decision of decisions) {
      const meta = decision.metadata as any
      lines.push(`- **${meta.title}**: ${meta.decision}`)
    }
  }

  return lines.join('\n')
}
