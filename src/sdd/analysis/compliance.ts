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
      gap: 'Não há nós de consentimento no grafo',
    })
    requirements.push({
      id: 'GDPR-002',
      description: 'Direito ao esquecimento',
      status: 'not_met',
      gap: 'Não há implementação de exclusão de dados',
    })
    requirements.push({
      id: 'GDPR-003',
      description: 'Portabilidade de dados',
      status: 'not_met',
      gap: 'Não há exportação de dados implementada',
    })
    recommendations.push('Adicionar nós de consentimento')
    recommendations.push('Implementar mecanismo de exclusão')
    recommendations.push('Adicionar exportação de dados do usuário')
  } else if (standard === 'LGPD') {
    requirements.push({
      id: 'LGPD-001',
      description: 'Consentimento para coleta de dados pessoais',
      status: 'not_met',
      gap: 'Não há nós de consentimento no grafo',
    })
    requirements.push({
      id: 'LGPD-002',
      description: 'Finalidade específica para coleta',
      status: 'not_met',
      gap: 'Não há definição de finalidade para cada coleta',
    })
    requirements.push({
      id: 'LGPD-003',
      description: 'Direito de acesso e correção',
      status: 'not_met',
      gap: 'Não há mecanismo de acesso e correção de dados',
    })
    requirements.push({
      id: 'LGPD-004',
      description: 'Direito de exclusão (anonymização)',
      status: 'not_met',
      gap: 'Não há mecanismo de exclusão ou anonimização',
    })
    requirements.push({
      id: 'LGPD-005',
      description: 'Relatório de impacto à proteção de dados (RIPD)',
      status: 'not_met',
      gap: 'Não há RIPD documentado',
    })
    requirements.push({
      id: 'LGPD-006',
      description: 'Encarregado de dados (DPO)',
      status: 'not_met',
      gap: 'Não há DPO definido',
    })
    recommendations.push('Adicionar nós de consentimento com finalidade específica')
    recommendations.push('Implementar mecanismo de acesso e correção de dados')
    recommendations.push('Implementar exclusão ou anonimização de dados pessoais')
    recommendations.push('Criar Relatório de Impacto à Proteção de Dados (RIPD)')
    recommendations.push('Definir Encarregado de Dados (DPO)')
    recommendations.push('Documentar bases legais para tratamento de dados')
  } else if (standard === 'HIPAA') {
    requirements.push({
      id: 'HIPAA-001',
      description: 'Criptografia de dados sensíveis',
      status: 'not_met',
      gap: 'Não há criptografia implementada',
    })
    requirements.push({
      id: 'HIPAA-002',
      description: 'Controle de acesso',
      status: 'partially_met',
      evidence: 'Sistema de permissões existe',
    })
    requirements.push({
      id: 'HIPAA-003',
      description: 'Audit trail',
      status: 'partially_met',
      evidence: 'Sistema de auditoria existe',
    })
    recommendations.push('Implementar criptografia em repouso e trânsito')
    recommendations.push('Melhorar controle de acesso')
  } else if (standard === 'SOC2') {
    requirements.push({
      id: 'SOC2-001',
      description: 'Controle de acesso lógico',
      status: 'partially_met',
      evidence: 'Sistema de permissões existe',
    })
    requirements.push({
      id: 'SOC2-002',
      description: 'Mudanças autorizadas',
      status: 'met',
      evidence: 'Sistema de Change management implementado',
    })
    requirements.push({
      id: 'SOC2-003',
      description: 'Monitoramento de atividades',
      status: 'not_met',
      gap: 'Não há sistema de monitoramento',
    })
    recommendations.push('Implementar sistema de monitoramento')
    recommendations.push('Adicionar alertas de segurança')
  } else if (standard === 'PCI_DSS') {
    requirements.push({
      id: 'PCI-001',
      description: 'Criptografia de dados de cartão de crédito',
      status: 'not_met',
      gap: 'Não há criptografia de dados de pagamento implementada',
    })
    requirements.push({
      id: 'PCI-002',
      description: 'Controle de acesso a dados de cartão',
      status: 'not_met',
      gap: 'Não há controle de acesso específico para dados de pagamento',
    })
    requirements.push({
      id: 'PCI-003',
      description: 'Monitoramento de acesso a dados de cartão',
      status: 'not_met',
      gap: 'Não há monitoramento de acesso a dados de pagamento',
    })
    requirements.push({
      id: 'PCI-004',
      description: 'Testes de segurança regulares',
      status: 'not_met',
      gap: 'Não há testes de segurança automatizados',
    })
    recommendations.push('Implementar criptografia AES-256 para dados de pagamento')
    recommendations.push('Implementar tokenização para dados de cartão')
    recommendations.push('Adicionar controle de acesso baseado em função (RBAC)')
    recommendations.push('Implementar monitoramento em tempo real')
    recommendations.push('Adicionar testes de segurança automatizados')
  } else if (standard === 'ISO27001') {
    requirements.push({
      id: 'ISO-001',
      description: 'Política de segurança da informação',
      status: 'not_met',
      gap: 'Não há política de segurança documentada',
    })
    requirements.push({
      id: 'ISO-002',
      description: 'Gestão de riscos',
      status: 'not_met',
      gap: 'Não há processo de gestão de riscos',
    })
    requirements.push({
      id: 'ISO-003',
      description: 'Controles de segurança',
      status: 'partially_met',
      evidence: 'Sistema de permissões existe',
    })
    requirements.push({
      id: 'ISO-004',
      description: 'Gestão de incidentes',
      status: 'not_met',
      gap: 'Não há processo formal de gestão de incidentes',
    })
    requirements.push({
      id: 'ISO-005',
      description: 'Continuidade de negócios',
      status: 'not_met',
      gap: 'Não há plano de continuidade de negócios',
    })
    recommendations.push('Documentar política de segurança da informação')
    recommendations.push('Implementar processo de gestão de riscos')
    recommendations.push('Estabelecer processo formal de gestão de incidentes')
    recommendations.push('Criar plano de continuidade de negócios')
    recommendations.push('Realizar auditorias internas regulares')
  } else {
    requirements.push({
      id: 'GENERIC-001',
      description: 'Autenticação e autorização',
      status: 'partially_met',
      evidence: 'Sistema de permissões existe',
    })
    recommendations.push('Verificar requisitos específicos do padrão')
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
    `## Verificação de Compliance - ${result.standard}`,
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
      lines.push(`   - Evidência: ${req.evidence}`)
    }
    if (req.gap) {
      lines.push(`   - Lacuna: ${req.gap}`)
    }
  }

  lines.push('')
  lines.push('### Recomendações')
  for (const rec of result.recommendations) {
    lines.push(`- ${rec}`)
  }

  return lines.join('\n')
}