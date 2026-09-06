export interface FunctionMetrics {
  name: string
  file: string
  line_start: number
  line_end: number
  lines_of_code: number
  nesting_depth: number
  parameter_count: number
 LOC: number
  LLOC: number
  SLOC: number
  comments: number
  blank_lines: number
}

export interface CodeMetricsReport {
  functions: FunctionMetrics[]
  file_summary: {
    total_lines: number
    total_code_lines: number
    total_comment_lines: number
    total_blank_lines: number
    average_function_length: number
    longest_function: string
    shortest_function: string
  }
  issues: Array<{
    type: string
    function: string
    severity: 'warning' | 'error'
    message: string
  }>
}

function countNestingDepth(code: string): number {
  let maxDepth = 0
  let currentDepth = 0

  for (const char of code) {
    if (char === '{') {
      currentDepth++
      maxDepth = Math.max(maxDepth, currentDepth)
    } else if (char === '}') {
      currentDepth = Math.max(0, currentDepth - 1)
    }
  }

  return maxDepth
}

function countParameters(code: string): number {
  const paramMatch = code.match(/\(([^)]*)\)/)
  if (!paramMatch || !paramMatch[1].trim()) return 0

  const params = paramMatch[1].split(',')
  return params.filter(p => p.trim()).length
}

function countLines(code: string): { LOC: number; LLOC: number; SLOC: number; comments: number; blank_lines: number } {
  const lines = code.split('\n')
  const LOC = lines.length

  let comments = 0
  let blank_lines = 0
  let inBlockComment = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (inBlockComment) {
      comments++
      if (trimmed.includes('*/')) {
        inBlockComment = false
      }
      continue
    }

    if (trimmed === '') {
      blank_lines++
      continue
    }

    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      comments++
      continue
    }

    if (trimmed.startsWith('/*')) {
      comments++
      if (!trimmed.includes('*/')) {
        inBlockComment = true
      }
      continue
    }
  }

  const LLOC = LOC - blank_lines - comments
  const SLOC = LLOC

  return { LOC, LLOC, SLOC, comments, blank_lines }
}

export function analyzeMetrics(code: string, fileName: string): CodeMetricsReport {
  const functions: FunctionMetrics[] = []
  const issues: CodeMetricsReport['issues'] = []

  const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{)/g

  let match
  while ((match = functionRegex.exec(code)) !== null) {
    const name = match[1] || match[2] || match[3]
    const startLine = code.substring(0, match.index).split('\n').length

    let braceCount = 0
    let endLine = startLine
    let inFunction = false

    for (let i = match.index; i < code.length; i++) {
      if (code[i] === '{') {
        braceCount++
        inFunction = true
      } else if (code[i] === '}') {
        braceCount--
        if (inFunction && braceCount === 0) {
          endLine = code.substring(0, i + 1).split('\n').length
          break
        }
      }
    }

    const functionCode = code.substring(match.index, code.indexOf('}', code.indexOf('{', match.index)) + 1)
    const lines = countLines(functionCode)
    const nestingDepth = countNestingDepth(functionCode)
    const parameterCount = countParameters(functionCode)

    functions.push({
      name,
      file: fileName,
      line_start: startLine,
      line_end: endLine,
      lines_of_code: lines.LOC,
      nesting_depth: nestingDepth,
      parameter_count: parameterCount,
      ...lines,
    })

    if (parameterCount > 5) {
      issues.push({
        type: 'long_parameter_list',
        function: name,
        severity: 'warning',
        message: `Função ${name} tem ${parameterCount} parâmetros (máximo recomendado: 5)`,
      })
    }

    if (lines.LOC > 50) {
      issues.push({
        type: 'long_function',
        function: name,
        severity: 'warning',
        message: `Função ${name} tem ${lines.LOC} linhas (máximo recomendado: 50)`,
      })
    }

    if (nestingDepth > 4) {
      issues.push({
        type: 'deep_nesting',
        function: name,
        severity: 'warning',
        message: `Função ${name} tem aninhamento de ${nestingDepth} níveis (máximo recomendado: 4)`,
      })
    }
  }

  const allLines = countLines(code)
  const totalFunctionLines = functions.reduce((sum, f) => sum + f.lines_of_code, 0)
  const avgFunctionLength = functions.length > 0 ? totalFunctionLines / functions.length : 0

  const longestFunction = functions.reduce((longest, f) => f.lines_of_code > longest.lines_of_code ? f : longest, functions[0])
  const shortestFunction = functions.reduce((shortest, f) => f.lines_of_code < shortest.lines_of_code ? f : shortest, functions[0])

  return {
    functions,
    file_summary: {
      total_lines: allLines.LOC,
      total_code_lines: allLines.LLOC,
      total_comment_lines: allLines.comments,
      total_blank_lines: allLines.blank_lines,
      average_function_length: Math.round(avgFunctionLength),
      longest_function: longestFunction?.name || 'N/A',
      shortest_function: shortestFunction?.name || 'N/A',
    },
    issues,
  }
}

export function formatMetricsReport(report: CodeMetricsReport): string {
  const lines = [
    '## Métricas de Código',
    '',
    '### Resumo do Arquivo',
    `- **Total de Linhas:** ${report.file_summary.total_lines}`,
    `- **Linhas de Código:** ${report.file_summary.total_code_lines}`,
    `- **Linhas de Comentário:** ${report.file_summary.total_comment_lines}`,
    `- **Linhas em Branco:** ${report.file_summary.total_blank_lines}`,
    `- **Média de Linhas por Função:** ${report.file_summary.average_function_length}`,
    `- **Função Maior:** ${report.file_summary.longest_function}`,
    `- **Função Menor:** ${report.file_summary.shortest_function}`,
    '',
  ]

  if (report.issues.length > 0) {
    lines.push('### Problemas Detectados')
    for (const issue of report.issues) {
      const icon = issue.severity === 'error' ? '❌' : '⚠️'
      lines.push(`${icon} **${issue.type}**: ${issue.message}`)
    }
    lines.push('')
  }

  lines.push('### Detalhes por Função')
  for (const func of report.functions) {
    lines.push(`#### ${func.name}`)
    lines.push(`- **Linhas:** ${func.lines_of_code}`)
    lines.push(`- **Parâmetros:** ${func.parameter_count}`)
    lines.push(`- **Aninhamento:** ${func.nesting_depth}`)
    lines.push(`- **LOC/LLOC/SLOC:** ${func.LOC}/${func.LLOC}/${func.SLOC}`)
    lines.push('')
  }

  return lines.join('\n')
}