import type { KnowledgeGraph } from '../domain/types.js'

export interface KnowledgeTransferData {
  architectural_decisions: Array<{
    title: string
    decision: string
    context: string
  }>
  key_patterns: string[]
  common_issues: string[]
  critical_files: string[]
}

export interface KnowledgeTransferOptions {
  /** Only include decisions with these IDs. */
  focusDecisions?: string[]
  /** Max items per category (default: unlimited). */
  maxItems?: number
  /** Only include these categories: 'decisions' | 'patterns' | 'issues' | 'files' | 'all'. */
  focusAreas?: 'decisions' | 'patterns' | 'issues' | 'files' | 'all'
  /** Custom filter for decisions (return true to include). */
  decisionFilter?: (decision: any) => boolean
}

export function generateKnowledgeTransfer(
  graph: KnowledgeGraph,
  options?: KnowledgeTransferOptions,
): KnowledgeTransferData {
  const architectural_decisions: KnowledgeTransferData['architectural_decisions'] = []
  const key_patterns: string[] = []
  const common_issues: string[] = []
  const critical_files: string[] = []
  const maxItems = options?.maxItems ?? Infinity
  const focusAreas = options?.focusAreas ?? 'all'

  if (focusAreas === 'all' || focusAreas === 'decisions') {
    let decisions = graph.nodes.filter(n => n.type === 'decision')
    if (options?.focusDecisions?.length) {
      decisions = decisions.filter(d => options.focusDecisions!.includes(d.id))
    }
    if (options?.decisionFilter) {
      decisions = decisions.filter(options.decisionFilter)
    }
    for (const decision of decisions.slice(0, maxItems)) {
      const meta = decision.metadata as any
      architectural_decisions.push({
        title: meta.title,
        decision: meta.decision,
        context: meta.context,
      })
    }
  }

  if (focusAreas === 'all' || focusAreas === 'patterns') {
    const constraints = graph.nodes.filter(n => n.type === 'constraint')
    for (const constraint of constraints.slice(0, maxItems)) {
      const meta = constraint.metadata as any
      key_patterns.push(`${meta.constraint_type}: ${meta.rule_text}`)
    }
  }

  if (focusAreas === 'all' || focusAreas === 'issues') {
    const antiPatterns = graph.nodes.filter(n => n.type === 'assumption')
    for (const assumption of antiPatterns.slice(0, maxItems)) {
      const meta = assumption.metadata as any
      if (meta.requires_confirmation) {
        common_issues.push(`Unconfirmed assumption: ${meta.description}`)
      }
    }

    const findings = graph.nodes.filter(n => n.type === 'finding')
    for (const finding of findings.slice(0, maxItems)) {
      const meta = finding.metadata as any
      const resolution = meta.resolution?.description ? ` — resolution: ${meta.resolution.description}` : ''
      common_issues.push(`[${finding.status}/${meta.severity ?? 'unknown'}] ${meta.title ?? finding.name}: ${meta.observed_behavior ?? finding.description ?? ''}${resolution}`)
    }
  }

  if (focusAreas === 'all' || focusAreas === 'files') {
    const files = graph.nodes.filter(n => n.type === 'file')
    const criticalFiles = files.filter(f => {
      const incoming = graph.relationships.filter(r => r.to === f.id)
      return incoming.length > 3
    })
    
    for (const file of criticalFiles.slice(0, Math.min(maxItems, 5))) {
      const meta = file.metadata as any
      critical_files.push(meta.path)
    }
  }

  return {
    architectural_decisions,
    key_patterns,
    common_issues,
    critical_files,
  }
}

export function formatKnowledgeTransfer(data: KnowledgeTransferData): string {
  const lines = [
    '## Knowledge Transfer',
    '',
  ]

  if (data.architectural_decisions.length > 0) {
    lines.push('### Architectural Decisions')
    for (const decision of data.architectural_decisions) {
      lines.push(`#### ${decision.title}`)
      lines.push(`- **Decision:** ${decision.decision}`)
      lines.push(`- **Contexto:** ${decision.context}`)
      lines.push('')
    }
  }

  if (data.key_patterns.length > 0) {
    lines.push('### Main Patterns')
    for (const pattern of data.key_patterns) {
      lines.push(`- ${pattern}`)
    }
  }

  if (data.common_issues.length > 0) {
    lines.push('', '### Problemas Comuns')
    for (const issue of data.common_issues) {
      lines.push(`- ${issue}`)
    }
  }

  if (data.critical_files.length > 0) {
    lines.push('', '### Critical Files')
    for (const file of data.critical_files) {
      lines.push(`- ${file}`)
    }
  }

  lines.push(
    '',
    '### Next Steps',
    '1. Read the architectural decisions',
    '2. Understand the main patterns',
    '3. Check the common issues',
    '4. Explore the critical files',
  )

  return lines.join('\n')
}
