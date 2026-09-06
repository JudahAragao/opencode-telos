import type { KnowledgeGraph } from '../domain/types.js'

export interface CostEstimate {
  infrastructure: Array<{
    service: string
    cost: number
    unit: string
  }>
  development: Array<{
    task: string
    hours: number
    rate: number
  }>
  total_infrastructure: number
  total_development: number
  total_monthly: number
}

export interface CostEstimationOptions {
  /** Custom hourly rate (default: 50). */
  customRate?: number
  /** Custom rates per task type. Overrides customRate for matching tasks. */
  customRates?: Record<string, number>
  /** Only estimate costs for these areas: 'infrastructure' | 'development' | 'all'. */
  focusAreas?: 'infrastructure' | 'development' | 'all'
  /** Currency symbol (default: '$'). */
  currency?: string
  /** Custom infrastructure costs. Key: service name. */
  customInfraCosts?: Record<string, number>
}

export function estimateCost(
  graph: KnowledgeGraph,
  options?: CostEstimationOptions,
): CostEstimate {
  const infrastructure: CostEstimate['infrastructure'] = []
  const development: CostEstimate['development'] = []
  const rate = options?.customRate ?? 50
  const focusAreas = options?.focusAreas ?? 'all'
  const customRates = options?.customRates ?? {}
  const customInfra = options?.customInfraCosts ?? {}

  const endpoints = graph.nodes.filter(n => n.type === 'endpoint')
  const entities = graph.nodes.filter(n => n.type === 'entity')
  const databases = graph.nodes.filter(n => n.type === 'database')

  if (focusAreas === 'all' || focusAreas === 'infrastructure') {
    infrastructure.push({
      service: 'Servidor Web',
      cost: customInfra['Servidor Web'] ?? 20,
      unit: 'mês',
    })

    if (databases.length > 0) {
      infrastructure.push({
        service: 'Banco de Dados',
        cost: customInfra['Banco de Dados'] ?? 25,
        unit: 'mês',
      })
    }

    if (endpoints.length > 10) {
      infrastructure.push({
        service: 'Load Balancer',
        cost: customInfra['Load Balancer'] ?? 15,
        unit: 'mês',
      })
    }

    infrastructure.push({
      service: 'Armazenamento',
      cost: customInfra['Armazenamento'] ?? 5,
      unit: 'mês',
    })
  }

  if (focusAreas === 'all' || focusAreas === 'development') {
    const setupRate = customRates['Setup inicial'] ?? rate
    development.push({
      task: 'Setup inicial',
      hours: 8,
      rate: setupRate,
    })

    const entityRate = customRates['Entidades e models'] ?? rate
    development.push({
      task: 'Entidades e models',
      hours: entities.length * 4,
      rate: entityRate,
    })

    const endpointRate = customRates['Endpoints da API'] ?? rate
    development.push({
      task: 'Endpoints da API',
      hours: endpoints.length * 2,
      rate: endpointRate,
    })

    const testRate = customRates['Testes'] ?? rate
    development.push({
      task: 'Testes',
      hours: (entities.length + endpoints.length) * 1,
      rate: testRate,
    })
  }

  const total_infrastructure = infrastructure.reduce((sum, item) => sum + item.cost, 0)
  const total_development = development.reduce((sum, item) => sum + (item.hours * item.rate), 0)
  const total_monthly = total_infrastructure

  return {
    infrastructure,
    development,
    total_infrastructure,
    total_development,
    total_monthly,
  }
}

export function formatCostEstimate(estimate: CostEstimate): string {
  const lines = [
    '## Estimativa de Custos',
    '',
    '### Infraestrutura (Mensal)',
  ]

  for (const item of estimate.infrastructure) {
    lines.push(`- **${item.service}:** $${item.cost}/${item.unit}`)
  }
  lines.push(`- **Total Infraestrutura:** $${estimate.total_infrastructure}/mês`)

  lines.push('', '### Desenvolvimento (Único)')
  for (const item of estimate.development) {
    lines.push(`- **${item.task}:** ${item.hours}h × $${item.rate}/h = $${item.hours * item.rate}`)
  }
  lines.push(`- **Total Desenvolvimento:** $${estimate.total_development}`)

  lines.push(
    '',
    '### Resumo',
    `- **Custo Mensal:** $${estimate.total_monthly}`,
    `- **Custo Único:** $${estimate.total_development}`,
    `- **Custo Total Primeiro Ano:** $${estimate.total_development + estimate.total_monthly * 12}`,
  )

  return lines.join('\n')
}