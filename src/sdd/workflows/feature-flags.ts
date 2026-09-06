import type { KnowledgeGraph, ChangeNode, FeatureFlagNode } from '../domain/types.js'

export interface FeatureFlagWorkflow {
  id: string
  flag_name: string
  description: string
  rollout_percentage: number
  target_audience?: string
}

export function createFeatureFlagChange(
  _graph: KnowledgeGraph,
  workflow: FeatureFlagWorkflow
): { change: ChangeNode; featureFlag: FeatureFlagNode } {
  const changeId = `change-flag-${Date.now()}`
  const flagId = `flag-${Date.now()}`

  const featureFlag: FeatureFlagNode = {
    id: flagId,
    type: 'feature_flag',
    name: `Feature Flag: ${workflow.flag_name}`,
    description: workflow.description,
    status: 'PROPOSED',
    version: 1,
    metadata: {
      flag_name: workflow.flag_name,
      description: workflow.description,
      enabled: false,
      rollout_percentage: workflow.rollout_percentage,
      target_audience: workflow.target_audience,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const change: ChangeNode = {
    id: changeId,
    type: 'change',
    name: `Feature Flag: ${workflow.flag_name}`,
    description: workflow.description,
    status: 'PROPOSED',
    version: 1,
    metadata: {
      title: `Feature Flag: ${workflow.flag_name}`,
      reason: workflow.description,
      approval_level: 'AUTO',
      affected_nodes: [flagId],
      affected_relationships: [],
      new_nodes: [flagId],
      removed_nodes: [],
      modified_nodes: [],
      affected_files: [],
      affected_tests: [],
      implementation_tasks: [],
      origin: 'feature_flag_workflow',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  return { change, featureFlag }
}

export function getFeatureFlagInstructions(featureFlag: FeatureFlagNode): string {
  const lines = [
    '## Feature Flag Workflow',
    '',
    `**Flag:** ${featureFlag.metadata.flag_name}`,
    `**Description:** ${featureFlag.metadata.description}`,
    `**Rollout:** ${featureFlag.metadata.rollout_percentage}%`,
    '',
    '### Implementation',
    '1. Create flag check in code',
    '2. Wrap feature with flag condition',
    '3. Set up flag management',
    '4. Monitor usage',
    '',
    '### Rollout Strategy',
    '1. Start with 0% rollout',
    '2. Gradually increase percentage',
    '3. Monitor metrics',
    '4. Full rollout when confident',
    '5. Remove flag after cleanup period',
  ]

  if (featureFlag.metadata.target_audience) {
    lines.push('', `**Target Audience:** ${featureFlag.metadata.target_audience}`)
  }

  return lines.join('\n')
}