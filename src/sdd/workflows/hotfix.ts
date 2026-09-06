import type { KnowledgeGraph, ChangeNode, HotfixNode } from '../domain/types.js'

export interface HotfixWorkflow {
  id: string
  description: string
  files: string[]
  urgency: 'critical' | 'high' | 'medium'
}

export function createHotfixChange(
  _graph: KnowledgeGraph,
  workflow: HotfixWorkflow
): { change: ChangeNode; hotfix: HotfixNode } {
  const changeId = `change-hotfix-${Date.now()}`
  const hotfixId = `hotfix-${Date.now()}`

  const hotfix: HotfixNode = {
    id: hotfixId,
    type: 'hotfix',
    name: `Hotfix: ${workflow.description}`,
    description: workflow.description,
    status: 'PROPOSED',
    version: 1,
    metadata: {
      incident_description: workflow.description,
      urgency: workflow.urgency,
      fix_applied: false,
      post_hoc_documented: false,
      rollback_available: false,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const change: ChangeNode = {
    id: changeId,
    type: 'change',
    name: `Hotfix: ${workflow.description}`,
    description: workflow.description,
    status: 'PROPOSED',
    version: 1,
    metadata: {
      title: `Hotfix: ${workflow.description}`,
      reason: workflow.description,
      approval_level: 'POST_HOC',
      affected_nodes: [hotfixId],
      affected_relationships: [],
      new_nodes: [hotfixId],
      removed_nodes: [],
      modified_nodes: [],
      affected_files: workflow.files,
      affected_tests: [],
      implementation_tasks: [],
      origin: 'hotfix_workflow',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  return { change, hotfix }
}

export function getHotfixInstructions(hotfix: HotfixNode): string {
  const lines = [
    '## Hotfix Workflow',
    '',
    `**Incident:** ${hotfix.metadata.incident_description}`,
    `**Urgency:** ${hotfix.metadata.urgency}`,
    '',
    '### Emergency Mode',
    '1. Enforcement is temporarily disabled',
    '2. Apply the fix directly',
    '3. After fix is applied, document retroactively',
    '',
    '### Post-Hoc Documentation',
    'After the incident is resolved:',
    '1. Use `sdd.hotfix` to document the change',
    '2. Create proper Change node with status COMPLETED',
    '3. Re-enable enforcement',
  ]

  return lines.join('\n')
}