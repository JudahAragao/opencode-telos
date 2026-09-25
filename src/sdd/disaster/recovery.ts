import type { KnowledgeGraph } from '../domain/types.js'

export interface DisasterRecoveryPlan {
  rto: string
  rpo: string
  backup_strategy: string
  failover_procedure: string[]
  recovery_steps: string[]
}

export function generateDisasterRecoveryPlan(_graph: KnowledgeGraph): DisasterRecoveryPlan {
  const rto = "4 horas"
  const rpo = "1 hora"
  
  const backup_strategy = [
    'Daily database backup',
    'Backup incremental a cada hora',
    'Knowledge Graph backup before every change',
    'Storage in a different geographic location',
  ].join('\n')

  const failover_procedure = [
    'Detect the primary failure',
    'Ativar sistema de backup',
    'Redirect traffic',
    'Verify data integrity',
    'Notificar stakeholders',
  ]

  const recovery_steps = [
    'Assess the extent of the failure',
    'Restaurar do backup mais recente',
    'Verify data integrity',
    'Resume normal operations',
    'Documentar incidente',
    'Implementar melhorias',
  ]

  return {
    rto,
    rpo,
    backup_strategy,
    failover_procedure,
    recovery_steps,
  }
}

export function formatDisasterRecoveryPlan(plan: DisasterRecoveryPlan): string {
  const lines = [
    '## Plano de Disaster Recovery',
    '',
    `**RTO (Recovery Time Objective):** ${plan.rto}`,
    `**RPO (Recovery Point Objective):** ${plan.rpo}`,
    '',
    '### Backup Strategy',
    plan.backup_strategy.split('\n').map(line => `- ${line}`).join('\n'),
    '',
    '### Procedimento de Failover',
  ]

  for (let i = 0; i < plan.failover_procedure.length; i++) {
    lines.push(`${i + 1}. ${plan.failover_procedure[i]}`)
  }

  lines.push('', '### Recovery Steps')
  for (let i = 0; i < plan.recovery_steps.length; i++) {
    lines.push(`${i + 1}. ${plan.recovery_steps[i]}`)
  }

  lines.push(
    '',
    '### Emergency Contacts',
    '- **Primary team:** [add contacts]',
    '- **Vendor:** [add contact]',
    '- **Support:** [add contact]',
  )

  return lines.join('\n')
}