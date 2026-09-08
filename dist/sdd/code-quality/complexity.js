import { fileMatchesFocus } from "./utils.js";
function calculateCyclomaticComplexity(code) {
    let complexity = 1;
    const keywords = [
        /\bif\b/g,
        /\belse\s+if\b/g,
        /\bwhile\b/g,
        /\bfor\b/g,
        /\bdo\b/g,
        /\bswitch\b/g,
        /\bcase\b/g,
        /\bcatch\b/g,
        /\b\?\:/g,
        /\&\&/g,
        /\|\|/g,
        /\?\./g,
    ];
    for (const keyword of keywords) {
        const matches = code.match(keyword);
        if (matches) {
            complexity += matches.length;
        }
    }
    return complexity;
}
function calculateCognitiveComplexity(code) {
    let complexity = 0;
    let nestingLevel = 0;
    const lines = code.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/\b(if|else\s+if|else|while|for|do|switch|catch)\b/)) {
            complexity += 1 + nestingLevel;
            nestingLevel++;
        }
        if (trimmed.match(/\}/)) {
            nestingLevel = Math.max(0, nestingLevel - 1);
        }
        if (trimmed.match(/\b(break|continue)\b/)) {
            complexity += 1;
        }
        if (trimmed.match(/\b(goto)\b/)) {
            complexity += 2;
        }
    }
    return complexity;
}
function assessRisk(cyclomatic, cognitive) {
    if (cyclomatic > 20 || cognitive > 30)
        return 'very_high';
    if (cyclomatic > 10 || cognitive > 15)
        return 'high';
    if (cyclomatic > 5 || cognitive > 8)
        return 'medium';
    return 'low';
}
export function analyzeComplexity(code, fileName, options) {
    // Early return if file doesn't match focusFiles
    if (options?.focusFiles?.length && !fileMatchesFocus(fileName, options.focusFiles)) {
        return { functions: [], summary: { total_functions: 0, average_cyclomatic: 0, average_cognitive: 0, high_risk_count: 0, very_high_risk_count: 0 } };
    }
    const functions = [];
    const riskOrder = { low: 0, medium: 1, high: 2, very_high: 3 };
    const minRiskLevel = options?.minRisk ? riskOrder[options.minRisk] ?? 0 : 0;
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{)/g;
    let match;
    while ((match = functionRegex.exec(code)) !== null) {
        const name = match[1] || match[2] || match[3];
        // Apply focus/exclude filters
        if (options?.focusFunctions?.length && !options.focusFunctions.some(p => name.includes(p)))
            continue;
        if (options?.excludeFunctions?.length && options.excludeFunctions.some(p => name.includes(p)))
            continue;
        const startLine = code.substring(0, match.index).split('\n').length;
        let braceCount = 0;
        let endLine = startLine;
        let inFunction = false;
        for (let i = match.index; i < code.length; i++) {
            if (code[i] === '{') {
                braceCount++;
                inFunction = true;
            }
            else if (code[i] === '}') {
                braceCount--;
                if (inFunction && braceCount === 0) {
                    endLine = code.substring(0, i + 1).split('\n').length;
                    break;
                }
            }
        }
        const functionCode = code.substring(match.index, code.indexOf('}', code.indexOf('{', match.index)) + 1);
        const lines = endLine - startLine + 1;
        const cyclomatic = calculateCyclomaticComplexity(functionCode);
        const cognitive = calculateCognitiveComplexity(functionCode);
        const risk = assessRisk(cyclomatic, cognitive);
        // Apply risk filter
        if (riskOrder[risk] < minRiskLevel)
            continue;
        functions.push({
            name,
            file: fileName,
            line_start: startLine,
            line_end: endLine,
            cyclomatic,
            cognitive,
            lines,
            risk,
        });
    }
    // Apply max results limit
    const limitedFunctions = options?.maxResults ? functions.slice(0, options.maxResults) : functions;
    const totalFunctions = limitedFunctions.length;
    const avgCyclomatic = totalFunctions > 0 ? limitedFunctions.reduce((sum, f) => sum + f.cyclomatic, 0) / totalFunctions : 0;
    const avgCognitive = totalFunctions > 0 ? limitedFunctions.reduce((sum, f) => sum + f.cognitive, 0) / totalFunctions : 0;
    const highRiskCount = limitedFunctions.filter(f => f.risk === 'high').length;
    const veryHighRiskCount = limitedFunctions.filter(f => f.risk === 'very_high').length;
    return {
        functions: limitedFunctions,
        summary: {
            total_functions: totalFunctions,
            average_cyclomatic: Math.round(avgCyclomatic * 100) / 100,
            average_cognitive: Math.round(avgCognitive * 100) / 100,
            high_risk_count: highRiskCount,
            very_high_risk_count: veryHighRiskCount,
        },
    };
}
export function formatComplexityReport(report) {
    const lines = [
        '## Relatório de Complexidade',
        '',
        `**Total de Funções:** ${report.summary.total_functions}`,
        `**Complexidade Ciclomática Média:** ${report.summary.average_cyclomatic}`,
        `**Complexidade Cognitiva Média:** ${report.summary.average_cognitive}`,
        `**Alto Risco:** ${report.summary.high_risk_count}`,
        `**Risco Muito Alto:** ${report.summary.very_high_risk_count}`,
        '',
    ];
    const highRisk = report.functions.filter(f => f.risk === 'high' || f.risk === 'very_high');
    if (highRisk.length > 0) {
        lines.push('### Funções de Alto Risco');
        for (const func of highRisk) {
            lines.push(`#### ${func.name} (${func.risk})`);
            lines.push(`- **Arquivo:** ${func.file}`);
            lines.push(`- **Linhas:** ${func.line_start}-${func.line_end} (${func.lines} linhas)`);
            lines.push(`- **Ciclomática:** ${func.cyclomatic}`);
            lines.push(`- **Cognitiva:** ${func.cognitive}`);
            lines.push('');
        }
    }
    const mediumRisk = report.functions.filter(f => f.risk === 'medium');
    if (mediumRisk.length > 0) {
        lines.push('### Funções de Risco Médio');
        for (const func of mediumRisk) {
            lines.push(`- **${func.name}**: ciclomática=${func.cyclomatic}, cognitiva=${func.cognitive}`);
        }
    }
    lines.push('', '### Recomendações', '- Funções com complexidade ciclomática > 10 devem ser refatoradas', '- Funções com complexidade cognitiva > 15 são difíceis de entender', '- Considere extrair lógica complexa em funções menores');
    return lines.join('\n');
}
