import type { KnowledgeGraph } from '../domain/types.js'

export interface MonitoringSetup {
  metrics: Array<{
    name: string
    type: 'counter' | 'gauge' | 'histogram' | 'summary'
    description: string
    labels?: string[]
  }>
  alerts: Array<{
    name: string
    condition: string
    severity: 'critical' | 'warning' | 'info'
    channels: string[]
  }>
  dashboards: Array<{
    name: string
    metrics: string[]
  }>
}

export function setupMonitoring(graph: KnowledgeGraph): MonitoringSetup {
  const metrics: MonitoringSetup['metrics'] = []
  const alerts: MonitoringSetup['alerts'] = []
  const dashboards: MonitoringSetup['dashboards'] = []

  const endpoints = graph.nodes.filter(n => n.type === 'endpoint')
  
  for (const endpoint of endpoints) {
    const meta = endpoint.metadata as any
    const metricName = `http_requests_total{method="${meta.method}",path="${meta.path}"}`
    
    metrics.push({
      name: metricName,
      type: 'counter',
      description: `Total de requisições para ${meta.method} ${meta.path}`,
      labels: ['method', 'path', 'status'],
    })
  }

  const entities = graph.nodes.filter(n => n.type === 'entity')
  
  if (entities.length > 0) {
    metrics.push({
      name: 'database_query_duration_seconds',
      type: 'histogram',
      description: 'Duração de consultas ao banco de dados',
      labels: ['operation', 'table'],
    })

    metrics.push({
      name: 'database_connections_active',
      type: 'gauge',
      description: 'Conexões ativas com o banco de dados',
    })
  }

  alerts.push({
    name: 'high_error_rate',
    condition: 'rate(http_requests_total{status=~"5.."}[5m]) > 0.1',
    severity: 'critical',
    channels: ['email', 'slack'],
  })

  alerts.push({
    name: 'high_latency',
    condition: 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 1',
    severity: 'warning',
    channels: ['slack'],
  })

  dashboards.push({
    name: 'API Overview',
    metrics: ['http_requests_total', 'http_request_duration_seconds'],
  })

  dashboards.push({
    name: 'Database',
    metrics: ['database_query_duration_seconds', 'database_connections_active'],
  })

  return { metrics, alerts, dashboards }
}

export function formatMonitoringSetup(setup: MonitoringSetup): string {
  const lines = [
    '## Configuração de Monitoramento',
    '',
    `**Métricas:** ${setup.metrics.length}`,
    `**Alertas:** ${setup.alerts.length}`,
    `**Dashboards:** ${setup.dashboards.length}`,
    '',
    '### Métricas',
  ]

  for (const metric of setup.metrics) {
    lines.push(`- **${metric.name}** (${metric.type}): ${metric.description}`)
  }

  lines.push('', '### Alertas')
  for (const alert of setup.alerts) {
    lines.push(`- **${alert.name}** (${alert.severity}): ${alert.condition}`)
    lines.push(`  - Canais: ${alert.channels.join(', ')}`)
  }

  lines.push('', '### Dashboards')
  for (const dashboard of setup.dashboards) {
    lines.push(`- **${dashboard.name}**: ${dashboard.metrics.join(', ')}`)
  }

  return lines.join('\n')
}

export interface DashboardConfig {
  title: string
  panels: Array<{
    title: string
    type: 'graph' | 'stat' | 'table' | 'heatmap' | 'gauge'
    query: string
    position: { x: number; y: number; w: number; h: number }
  }>
  refresh_interval: string
  time_range: string
}

export function generateDashboardConfig(
  graph: KnowledgeGraph,
  dashboardType: 'overview' | 'api' | 'database' | 'security'
): DashboardConfig {
  const panels: DashboardConfig['panels'] = []

  if (dashboardType === 'overview') {
    panels.push({
      title: 'Requisições por Minuto',
      type: 'graph',
      query: 'rate(http_requests_total[1m])',
      position: { x: 0, y: 0, w: 12, h: 6 },
    })
    panels.push({
      title: 'Taxa de Erro',
      type: 'stat',
      query: 'rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])',
      position: { x: 12, y: 0, w: 6, h: 3 },
    })
    panels.push({
      title: 'Latência P95',
      type: 'stat',
      query: 'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))',
      position: { x: 12, y: 3, w: 6, h: 3 },
    })
  } else if (dashboardType === 'api') {
    const endpoints = graph.nodes.filter(n => n.type === 'endpoint').slice(0, 5)
    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[i]
      const meta = endpoint.metadata as any
      panels.push({
        title: `${meta.method} ${meta.path}`,
        type: 'graph',
        query: `rate(http_requests_total{method="${meta.method}",path="${meta.path}"}[5m])`,
        position: { x: (i % 3) * 8, y: Math.floor(i / 3) * 6, w: 8, h: 6 },
      })
    }
  } else if (dashboardType === 'database') {
    panels.push({
      title: 'Conexões Ativas',
      type: 'gauge',
      query: 'database_connections_active',
      position: { x: 0, y: 0, w: 6, h: 4 },
    })
    panels.push({
      title: 'Duração de Consultas',
      type: 'heatmap',
      query: 'rate(database_query_duration_seconds_bucket[5m])',
      position: { x: 6, y: 0, w: 6, h: 4 },
    })
    panels.push({
      title: 'Consultas por Segundo',
      type: 'graph',
      query: 'rate(database_queries_total[5m])',
      position: { x: 0, y: 4, w: 12, h: 4 },
    })
  } else if (dashboardType === 'security') {
    panels.push({
      title: 'Tentativas de Login',
      type: 'graph',
      query: 'rate(login_attempts_total[5m])',
      position: { x: 0, y: 0, w: 6, h: 4 },
    })
    panels.push({
      title: 'Falhas de Login',
      type: 'stat',
      query: 'rate(login_attempts_total{status="failed"}[5m])',
      position: { x: 6, y: 0, w: 6, h: 4 },
    })
    panels.push({
      title: 'Acessos Não Autorizados',
      type: 'graph',
      query: 'rate(unauthorized_access_attempts_total[5m])',
      position: { x: 0, y: 4, w: 12, h: 4 },
    })
  }

  return {
    title: `Dashboard - ${dashboardType.charAt(0).toUpperCase() + dashboardType.slice(1)}`,
    panels,
    refresh_interval: '10s',
    time_range: '1h',
  }
}

export function formatDashboardConfig(config: DashboardConfig): string {
  const lines = [
    `## ${config.title}`,
    '',
    `**Intervalo de Atualização:** ${config.refresh_interval}`,
    `**Período:** ${config.time_range}`,
    `**Painéis:** ${config.panels.length}`,
    '',
    '### Painéis',
  ]

  for (const panel of config.panels) {
    lines.push(`#### ${panel.title} (${panel.type})`)
    lines.push(`- **Query:** \`${panel.query}\``)
    lines.push(`- **Posição:** x=${panel.position.x}, y=${panel.position.y}, w=${panel.position.w}, h=${panel.position.h}`)
    lines.push('')
  }

  lines.push(
    '### Configuração Grafana',
    '1. Importe este dashboard no Grafana',
    '2. Configure a fonte de dados (Prometheus)',
    '3. Ajuste os intervalos conforme necessário',
  )

  return lines.join('\n')
}