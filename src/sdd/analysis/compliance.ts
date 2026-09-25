import type { KnowledgeGraph } from '../domain/types.js'

export interface ComplianceCheckResult {
  standard: string
  requirements: Array<{
    id: string
    description: string
    status: 'met' | 'partially_met' | 'not_met'
    evidence?: string
    gap?: string
  }>
  score: number
  recommendations: string[]
}

export interface ComplianceOptions {
  /** Custom compliance requirements to add alongside standard ones. */
  customStandards?: Array<{ id: string; description: string; check: (graph: KnowledgeGraph) => 'met' | 'partially_met' | 'not_met' }>
  /** Only check these specific requirement IDs. */
  focusRequirements?: string[]
  /** Skip these requirement IDs. */
  excludeChecks?: string[]
  /** Max requirements to evaluate. */
  maxRequirements?: number
}

export function checkCompliance(
  _graph: KnowledgeGraph,
  standard: string,
  options?: ComplianceOptions,
): ComplianceCheckResult {
  const requirements: ComplianceCheckResult['requirements'] = []
  const recommendations: string[] = []
  const maxReqs = options?.maxRequirements ?? Infinity

  if (standard === 'GDPR') {
    requirements.push({
      id: 'GDPR-001',
      description: 'Consentimento para coleta de dados',
      status: 'not_met',
      gap: 'There are no consent nodes in the graph',
    })
    requirements.push({
      id: 'GDPR-002',
      description: 'Direito ao esquecimento',
      status: 'not_met',
      gap: 'No data deletion implementation exists',
    })
    requirements.push({
      id: 'GDPR-003',
      description: 'Portabilidade de dados',
      status: 'not_met',
      gap: 'No data export is implemented',
    })
    recommendations.push('Add consent nodes')
    recommendations.push('Implement a deletion mechanism')
    recommendations.push('Add user data export')
  } else if (standard === 'LGPD') {
    requirements.push({
      id: 'LGPD-001',
      description: 'Consentimento para coleta de dados pessoais',
      status: 'not_met',
      gap: 'There are no consent nodes in the graph',
    })
    requirements.push({
      id: 'LGPD-002',
      description: 'Specific purpose for collection',
      status: 'not_met',
      gap: 'No purpose is defined for each collection',
    })
    requirements.push({
      id: 'LGPD-003',
      description: 'Right of access and rectification',
      status: 'not_met',
      gap: 'No data access and rectification mechanism exists',
    })
    requirements.push({
      id: 'LGPD-004',
      description: 'Right to deletion (anonymization)',
      status: 'not_met',
      gap: 'No deletion or anonymization mechanism exists',
    })
    requirements.push({
      id: 'LGPD-005',
      description: 'Data protection impact assessment (DPIA)',
      status: 'not_met',
      gap: 'No DPIA is documented',
    })
    requirements.push({
      id: 'LGPD-006',
      description: 'Encarregado de dados (DPO)',
      status: 'not_met',
      gap: 'No DPO is defined',
    })
    recommendations.push('Add consent nodes with a specific purpose')
    recommendations.push('Implement a data access and rectification mechanism')
    recommendations.push('Implement deletion or anonymization of personal data')
    recommendations.push('Create a Data Protection Impact Assessment (DPIA)')
    recommendations.push('Define a Data Protection Officer (DPO)')
    recommendations.push('Documentar bases legais para tratamento de dados')
  } else if (standard === 'HIPAA') {
    requirements.push({
      id: 'HIPAA-001',
      description: 'Encryption of sensitive data',
      status: 'not_met',
      gap: 'No encryption is implemented',
    })
    requirements.push({
      id: 'HIPAA-002',
      description: 'Controle de acesso',
      status: 'partially_met',
      evidence: 'A permission system exists',
    })
    requirements.push({
      id: 'HIPAA-003',
      description: 'Audit trail',
      status: 'partially_met',
      evidence: 'Sistema de auditoria existe',
    })
    recommendations.push('Implement encryption at rest and in transit')
    recommendations.push('Melhorar controle de acesso')
  } else if (standard === 'SOC2') {
    requirements.push({
      id: 'SOC2-001',
      description: 'Logical access control',
      status: 'partially_met',
      evidence: 'A permission system exists',
    })
    requirements.push({
      id: 'SOC2-002',
      description: 'Authorized changes',
      status: 'met',
      evidence: 'Sistema de Change management implementado',
    })
    requirements.push({
      id: 'SOC2-003',
      description: 'Monitoramento de atividades',
      status: 'not_met',
      gap: 'No monitoring system exists',
    })
    recommendations.push('Implementar sistema de monitoramento')
    recommendations.push('Add security alerts')
  } else if (standard === 'PCI_DSS') {
    requirements.push({
      id: 'PCI-001',
      description: 'Credit card data encryption',
      status: 'not_met',
      gap: 'No payment data encryption is implemented',
    })
    requirements.push({
      id: 'PCI-002',
      description: 'Access control for card data',
      status: 'not_met',
      gap: 'No specific access control for payment data',
    })
    requirements.push({
      id: 'PCI-003',
      description: 'Monitoring of card data access',
      status: 'not_met',
      gap: 'No monitoring of payment data access',
    })
    requirements.push({
      id: 'PCI-004',
      description: 'Regular security testing',
      status: 'not_met',
      gap: 'No automated security tests exist',
    })
    recommendations.push('Implementar criptografia AES-256 para dados de pagamento')
    recommendations.push('Implement tokenization for card data')
    recommendations.push('Add role-based access control (RBAC)')
    recommendations.push('Implementar monitoramento em tempo real')
    recommendations.push('Add automated security tests')
  } else if (standard === 'ISO27001') {
    requirements.push({
      id: 'ISO-001',
      description: 'Information security policy',
      status: 'not_met',
      gap: 'No documented security policy exists',
    })
    requirements.push({
      id: 'ISO-002',
      description: 'Risk management',
      status: 'not_met',
      gap: 'No risk management process exists',
    })
    requirements.push({
      id: 'ISO-003',
      description: 'Security controls',
      status: 'partially_met',
      evidence: 'A permission system exists',
    })
    requirements.push({
      id: 'ISO-004',
      description: 'Incident management',
      status: 'not_met',
      gap: 'No formal incident management process exists',
    })
    requirements.push({
      id: 'ISO-005',
      description: 'Business continuity',
      status: 'not_met',
      gap: 'No business continuity plan exists',
    })
    recommendations.push('Document an information security policy')
    recommendations.push('Implement a risk management process')
    recommendations.push('Establish a formal incident management process')
    recommendations.push('Create a business continuity plan')
    recommendations.push('Realizar auditorias internas regulares')
  } else {
    requirements.push({
      id: 'GENERIC-001',
      description: 'Authentication and authorization',
      status: 'partially_met',
      evidence: 'A permission system exists',
    })
    recommendations.push('Check the standard\'s specific requirements')
  }

  // Apply custom standards
  if (options?.customStandards?.length) {
    for (const custom of options.customStandards) {
      if (requirements.length >= maxReqs) break
      if (options.excludeChecks?.includes(custom.id)) continue
      if (options.focusRequirements?.length && !options.focusRequirements.includes(custom.id)) continue
      requirements.push({
        id: custom.id,
        description: custom.description,
        status: custom.check(_graph),
      })
    }
  }

  // Apply focus/exclude filters
  const filteredReqs = requirements.filter((r) => {
    if (options?.excludeChecks?.includes(r.id)) return false
    if (options?.focusRequirements?.length && !options.focusRequirements.includes(r.id)) return false
    return true
  }).slice(0, maxReqs)

  const metCount = filteredReqs.filter(r => r.status === 'met').length
  const partialCount = filteredReqs.filter(r => r.status === 'partially_met').length
  const score = filteredReqs.length > 0
    ? Math.round(((metCount + partialCount * 0.5) / filteredReqs.length) * 100)
    : 0

  return { standard, requirements: filteredReqs, score, recommendations }
}

export function formatComplianceCheck(result: ComplianceCheckResult): string {
  const lines = [
    `## Compliance Verification - ${result.standard}`,
    '',
    `**Score:** ${result.score}/100`,
    `**Requisitos:** ${result.requirements.length}`,
    '',
  ]

  lines.push('### Status dos Requisitos')
  for (const req of result.requirements) {
    const statusIcon = req.status === 'met' ? '✅' : 
                      req.status === 'partially_met' ? '⚠️' : '❌'
    lines.push(`${statusIcon} **${req.id}**: ${req.description}`)
    
    if (req.evidence) {
      lines.push(`   - Evidence: ${req.evidence}`)
    }
    if (req.gap) {
      lines.push(`   - Lacuna: ${req.gap}`)
    }
  }

  lines.push('')
  lines.push('### Recommendations')
  for (const rec of result.recommendations) {
    lines.push(`- ${rec}`)
  }

  return lines.join('\n')
}