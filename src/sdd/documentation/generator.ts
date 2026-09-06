import type { KnowledgeGraph } from '../domain/types.js'

export interface DocumentationConfig {
  type: 'api' | 'user_guide' | 'developer_guide' | 'architecture'
  language?: string
}

export function generateDocumentation(
  graph: KnowledgeGraph,
  config: DocumentationConfig
): string {
  if (config.type === 'api') {
    return generateAPIDocumentation(graph)
  } else if (config.type === 'user_guide') {
    return generateUserGuide(graph)
  } else if (config.type === 'developer_guide') {
    return generateDeveloperGuide(graph)
  } else {
    return generateArchitectureDoc(graph)
  }
}

function generateAPIDocumentation(graph: KnowledgeGraph): string {
  const lines = [
    '# Documentação da API',
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
    '# Guia do Usuário',
    '',
    '## Visão Geral',
    '',
  ]

  const features = graph.nodes.filter(n => n.type === 'feature')
  
  if (features.length > 0) {
    lines.push('### Features Disponíveis')
    for (const feature of features) {
      lines.push(`- **${feature.name}**: ${feature.description || 'Sem descrição'}`)
    }
  }

  const useCases = graph.nodes.filter(n => n.type === 'use_case')
  
  if (useCases.length > 0) {
    lines.push('', '### Casos de Uso')
    for (const useCase of useCases) {
      lines.push(`- **${useCase.name}**: ${useCase.description || 'Sem descrição'}`)
    }
  }

  return lines.join('\n')
}

function generateDeveloperGuide(graph: KnowledgeGraph): string {
  const lines = [
    '# Guia do Desenvolvedor',
    '',
    '## Estrutura do Projeto',
    '',
  ]

  const modules = graph.nodes.filter(n => n.type === 'module')
  
  if (modules.length > 0) {
    lines.push('### Módulos')
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
    '1. Clone o repositório',
    '2. Instale as dependências',
    '3. Execute os testes',
    '4. Siga o workflow SDD',
  )

  return lines.join('\n')
}

function generateArchitectureDoc(graph: KnowledgeGraph): string {
  const lines = [
    '# Documentação de Arquitetura',
    '',
    '## Visão Geral',
    `**Total de Nós:** ${graph.nodes.length}`,
    `**Total de Relações:** ${graph.relationships.length}`,
    '',
  ]

  const components = graph.nodes.filter(n => n.type === 'architecture_component')
  
  if (components.length > 0) {
    lines.push('### Componentes')
    for (const component of components) {
      const meta = component.metadata as any
      lines.push(`- **${component.name}** (${meta.layer}): ${meta.technology || 'Não definido'}`)
    }
  }

  const decisions = graph.nodes.filter(n => n.type === 'decision')
  
  if (decisions.length > 0) {
    lines.push('', '### Decisões Arquiteturais')
    for (const decision of decisions) {
      const meta = decision.metadata as any
      lines.push(`- **${meta.title}**: ${meta.decision}`)
    }
  }

  return lines.join('\n')
}