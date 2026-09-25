import type { KnowledgeGraph } from '../domain/types.js'

export interface DependencyNode {
  id: string
  name: string
  type: string
  dependencies: string[]
  dependents: string[]
}

export interface DependencyReport {
  nodes: DependencyNode[]
  cycles: string[][]
  coupling: {
    afferent: Record<string, number>
    efferent: Record<string, number>
    instability: Record<string, number>
  }
  summary: {
    total_nodes: number
    total_dependencies: number
    cycles_found: number
    most_coupled: string
    least_stable: string
  }
}

function detectCycles(nodes: DependencyNode[]): string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  function dfs(nodeId: string, path: string[]): void {
    visited.add(nodeId)
    recursionStack.add(nodeId)
    path.push(nodeId)

    const node = nodes.find(n => n.id === nodeId)
    if (node) {
      for (const dep of node.dependencies) {
        if (!visited.has(dep)) {
          dfs(dep, [...path])
        } else if (recursionStack.has(dep)) {
          const cycleStart = path.indexOf(dep)
          if (cycleStart !== -1) {
            cycles.push(path.slice(cycleStart))
          }
        }
      }
    }

    recursionStack.delete(nodeId)
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, [])
    }
  }

  return cycles
}

function calculateCoupling(nodes: DependencyNode[]): DependencyReport['coupling'] {
  const afferent: Record<string, number> = {}
  const efferent: Record<string, number> = {}
  const instability: Record<string, number> = {}

  for (const node of nodes) {
    afferent[node.id] = node.dependents.length
    efferent[node.id] = node.dependencies.length

    const total = afferent[node.id] + efferent[node.id]
    instability[node.id] = total > 0 ? efferent[node.id] / total : 0
  }

  return { afferent, efferent, instability }
}

export function analyzeDependencies(graph: KnowledgeGraph): DependencyReport {
  const nodes: DependencyNode[] = []

  for (const node of graph.nodes) {
    const dependencies = graph.relationships
      .filter(r => r.from === node.id && ['depends_on', 'uses', 'calls', 'requires'].includes(r.type))
      .map(r => r.to)

    const dependents = graph.relationships
      .filter(r => r.to === node.id && ['depends_on', 'uses', 'calls', 'requires'].includes(r.type))
      .map(r => r.from)

    nodes.push({
      id: node.id,
      name: node.name,
      type: node.type,
      dependencies,
      dependents,
    })
  }

  const cycles = detectCycles(nodes)
  const coupling = calculateCoupling(nodes)

  const totalDependencies = nodes.reduce((sum, n) => sum + n.dependencies.length, 0)
  const mostCoupled = nodes.reduce((most, n) =>
    (n.dependencies.length + n.dependents.length) > (most.dependencies.length + most.dependents.length) ? n : most
  , nodes[0])

  const leastStable = Object.entries(coupling.instability)
    .reduce((max, [id, value]) => value > max.value ? { id, value } : max, { id: '', value: 0 })

  return {
    nodes,
    cycles,
    coupling,
    summary: {
      total_nodes: nodes.length,
      total_dependencies: totalDependencies,
      cycles_found: cycles.length,
      most_coupled: mostCoupled?.name || 'N/A',
      least_stable: leastStable.id ? nodes.find(n => n.id === leastStable.id)?.name || 'N/A' : 'N/A',
    },
  }
}

export function formatDependencyReport(report: DependencyReport): string {
  const lines = [
    '## Dependency Analysis',
    '',
    `**Total nodes:** ${report.summary.total_nodes}`,
    `**Total dependencies:** ${report.summary.total_dependencies}`,
    `**Ciclos Encontrados:** ${report.summary.cycles_found}`,
    `**Mais Acoplado:** ${report.summary.most_coupled}`,
    `**Least stable:** ${report.summary.least_stable}`,
    '',
  ]

  if (report.cycles.length > 0) {
    lines.push('### ⚠️ Dependency Cycles Detected')
    for (let i = 0; i < report.cycles.length; i++) {
      const cycle = report.cycles[i]
      lines.push(`**Ciclo ${i + 1}:**`)
      lines.push(cycle.map(id => {
        const node = report.nodes.find(n => n.id === id)
        return node?.name || id
      }).join(' → '))
    }
    lines.push('')
    lines.push('**Recommendation:** break the cycles by introducing interfaces or inverting dependencies.')
    lines.push('')
  }

  lines.push('### Acoplamento')
  lines.push('#### Nodes with Highest Coupling (Efferent)')
  const sortedByEfferent = Object.entries(report.coupling.efferent)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  for (const [id, count] of sortedByEfferent) {
    const node = report.nodes.find(n => n.id === id)
    if (node && count > 0) {
      lines.push(`- **${node.name}** (${node.type}): ${count} dependencies`)
    }
  }

  lines.push('')
  lines.push('#### Nodes with Highest Reuse (Afferent)')
  const sortedByAfferent = Object.entries(report.coupling.afferent)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  for (const [id, count] of sortedByAfferent) {
    const node = report.nodes.find(n => n.id === id)
    if (node && count > 0) {
      lines.push(`- **${node.name}** (${node.type}): ${count} dependentes`)
    }
  }

  lines.push('')
  lines.push('#### Instabilidade')
  const sortedByInstability = Object.entries(report.coupling.instability)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)

  for (const [id, value] of sortedByInstability) {
    const node = report.nodes.find(n => n.id === id)
    if (node) {
      const stability = value < 0.3 ? '🟢 Stable' : value < 0.7 ? '🟡 Moderate' : '🔴 Unstable'
      lines.push(`- **${node.name}**: ${(value * 100).toFixed(0)}% ${stability}`)
    }
  }

  lines.push(
    '',
    '### Recommendations',
    '- Avoid dependency cycles',
    '- Keep instability low for reusable modules',
    '- Use dependency inversion to decouple modules',
    '- Dependency Inversion Principle (SOLID)',
  )

  return lines.join('\n')
}