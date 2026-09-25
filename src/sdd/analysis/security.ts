import type { KnowledgeGraph } from '../domain/types.js'

export interface SecurityAuditResult {
  vulnerabilities: Array<{
    type: string
    severity: 'critical' | 'high' | 'medium' | 'low'
    location: string
    description: string
    recommendation: string
  }>
  score: number
  recommendations: string[]
}

export interface SecurityAuditOptions {
  /** Only audit these specific endpoint IDs. */
  focusEndpoints?: string[]
  /** Only audit these specific entity IDs. */
  focusEntities?: string[]
  /** Minimum severity to include in results. */
  minSeverity?: 'critical' | 'high' | 'medium' | 'low'
  /** Max vulnerabilities to report. */
  maxVulnerabilities?: number
}

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

export function performSecurityAudit(
  graph: KnowledgeGraph,
  options?: SecurityAuditOptions,
): SecurityAuditResult {
  const vulnerabilities: SecurityAuditResult['vulnerabilities'] = []
  const recommendations: string[] = []
  const maxVulns = options?.maxVulnerabilities ?? Infinity

  // Filter endpoints
  let endpoints = graph.nodes.filter(n => n.type === 'endpoint')
  if (options?.focusEndpoints?.length) {
    endpoints = endpoints.filter(e => options.focusEndpoints!.includes(e.id))
  }
  
  for (const endpoint of endpoints) {
    if (vulnerabilities.length >= maxVulns) break
    const meta = endpoint.metadata as any
    
    if (meta.method === 'POST' || meta.method === 'PUT' || meta.method === 'DELETE') {
      const hasAuth = graph.relationships.some(
        r => r.from === endpoint.id && r.type === 'requires'
      )
      
      if (!hasAuth) {
        const vuln = {
          type: 'missing_authentication',
          severity: 'high' as const,
          location: `${meta.method} ${meta.path}`,
          description: 'Modification endpoint without authentication',
          recommendation: 'Add authentication middleware',
        }
        if (!options?.minSeverity || SEVERITY_ORDER[vuln.severity] <= SEVERITY_ORDER[options.minSeverity]) {
          vulnerabilities.push(vuln)
        }
      }
    }
  }

  // Filter entities
  let entities = graph.nodes.filter(n => n.type === 'entity')
  if (options?.focusEntities?.length) {
    entities = entities.filter(e => options.focusEntities!.includes(e.id))
  }
  for (const entity of entities) {
    if (vulnerabilities.length >= maxVulns) break
    const fields = (entity.metadata as any).fields || []
    const sensitiveFields = fields.filter((f: any) => 
      f.name.includes('password') || 
      f.name.includes('token') || 
      f.name.includes('secret')
    )
    
    if (sensitiveFields.length > 0) {
      const vuln = {
        type: 'sensitive_dataexposure',
        severity: 'medium' as const,
        location: `Entity: ${entity.name}`,
        description: `Sensitive fields detected: ${sensitiveFields.map((f: any) => f.name).join(', ')}`,
        recommendation: 'Encrypt or mask sensitive fields',
      }
      if (!options?.minSeverity || SEVERITY_ORDER[vuln.severity] <= SEVERITY_ORDER[options.minSeverity]) {
        vulnerabilities.push(vuln)
      }
    }
  }

  const score = Math.max(0, 100 - vulnerabilities.length * 15)

  if (vulnerabilities.length === 0) {
    recommendations.push('No critical vulnerability detected')
  } else {
    recommendations.push('Fix vulnerabilities before production')
    recommendations.push('Implementar HTTPS em todos os endpoints')
    recommendations.push('Add rate limiting')
  }

  return { vulnerabilities, score, recommendations }
}

export function formatSecurityAudit(result: SecurityAuditResult): string {
  const lines = [
    '## Security Audit Report',
    '',
    `**Score:** ${result.score}/100`,
    `**Vulnerabilidades:** ${result.vulnerabilities.length}`,
    '',
  ]

  if (result.vulnerabilities.length > 0) {
    lines.push('### Vulnerabilidades Detectadas')
    for (const vuln of result.vulnerabilities) {
      lines.push(`#### ${vuln.type} (${vuln.severity})`)
      lines.push(`- **Local:** ${vuln.location}`)
      lines.push(`- **Description:** ${vuln.description}`)
      lines.push(`- **Recommendation:** ${vuln.recommendation}`)
      lines.push('')
    }
  } else {
    lines.push('✅ No vulnerability detected')
  }

  lines.push('### General Recommendations')
  for (const rec of result.recommendations) {
    lines.push(`- ${rec}`)
  }

  return lines.join('\n')
}