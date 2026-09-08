import { fileMatchesFocus } from "./utils.js";
function detectLongParameterList(code, fileName) {
    const smells = [];
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*\w+\s*)?\{)/g;
    let match;
    while ((match = functionRegex.exec(code)) !== null) {
        const name = match[1] || match[2] || match[3];
        const params = match[4] || '';
        if (params) {
            const paramCount = params.split(',').filter(p => p.trim()).length;
            if (paramCount > 5) {
                const line = code.substring(0, match.index).split('\n').length;
                smells.push({
                    type: 'long_parameter_list',
                    name,
                    severity: paramCount > 7 ? 'error' : 'warning',
                    location: `${fileName}:${line}`,
                    description: `Função ${name} tem ${paramCount} parâmetros`,
                    recommendation: 'Considere usar um objeto de opções ou agrupar parâmetros relacionados',
                });
            }
        }
    }
    return smells;
}
function detectGodClass(code, fileName) {
    const smells = [];
    const classRegex = /class\s+(\w+)[^{]*\{/g;
    let match;
    while ((match = classRegex.exec(code)) !== null) {
        const className = match[1];
        const startIdx = match.index;
        let braceCount = 0;
        let classBody = '';
        let inClass = false;
        for (let i = startIdx; i < code.length; i++) {
            if (code[i] === '{') {
                braceCount++;
                inClass = true;
            }
            else if (code[i] === '}') {
                braceCount--;
                if (inClass && braceCount === 0) {
                    classBody = code.substring(startIdx, i + 1);
                    break;
                }
            }
        }
        const methodCount = (classBody.match(/(?:public|private|protected|static|async|\w+\s*\([^)]*\)\s*\{)/g) || []).length;
        const propertyCount = (classBody.match(/(?:this\.\w+\s*=|private\s+\w+|protected\s+\w+|public\s+\w+)/g) || []).length;
        const LOC = classBody.split('\n').length;
        if (methodCount > 10 || propertyCount > 10 || LOC > 200) {
            const line = code.substring(0, match.index).split('\n').length;
            smells.push({
                type: 'god_class',
                name: className,
                severity: methodCount > 15 || propertyCount > 15 ? 'error' : 'warning',
                location: `${fileName}:${line}`,
                description: `Classe ${className} tem ${methodCount} métodos, ${propertyCount} propriedades e ${LOC} linhas`,
                recommendation: 'Considere dividir em classes menores com responsabilidades específicas',
            });
        }
    }
    return smells;
}
function detectFeatureEnvy(code, fileName) {
    const smells = [];
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{)/g;
    let match;
    while ((match = functionRegex.exec(code)) !== null) {
        const name = match[1] || match[2] || match[3];
        const startIdx = match.index;
        let braceCount = 0;
        let functionBody = '';
        let inFunction = false;
        for (let i = startIdx; i < code.length; i++) {
            if (code[i] === '{') {
                braceCount++;
                inFunction = true;
            }
            else if (code[i] === '}') {
                braceCount--;
                if (inFunction && braceCount === 0) {
                    functionBody = code.substring(startIdx, i + 1);
                    break;
                }
            }
        }
        const externalCalls = (functionBody.match(/(\w+)\.\w+\s*\(/g) || []);
        const callCounts = {};
        for (const call of externalCalls) {
            const obj = call.split('.')[0];
            callCounts[obj] = (callCounts[obj] || 0) + 1;
        }
        const maxCalls = Math.max(...Object.values(callCounts), 0);
        const maxObj = Object.keys(callCounts).find(k => callCounts[k] === maxCalls);
        if (maxCalls > 5 && maxObj && !['this', 'self'].includes(maxObj)) {
            const line = code.substring(0, match.index).split('\n').length;
            smells.push({
                type: 'feature_envy',
                name,
                severity: maxCalls > 8 ? 'error' : 'warning',
                location: `${fileName}:${line}`,
                description: `Função ${name} chama ${maxObj}.${maxCalls} vezes`,
                recommendation: `Considere mover esta função para a classe ${maxObj}`,
            });
        }
    }
    return smells;
}
function detectSwitchStatements(code, fileName) {
    const smells = [];
    const switchRegex = /switch\s*\([^)]*\)\s*\{/g;
    let match;
    while ((match = switchRegex.exec(code)) !== null) {
        const line = code.substring(0, match.index).split('\n').length;
        let braceCount = 0;
        let switchBody = '';
        let inSwitch = false;
        for (let i = match.index; i < code.length; i++) {
            if (code[i] === '{') {
                braceCount++;
                inSwitch = true;
            }
            else if (code[i] === '}') {
                braceCount--;
                if (inSwitch && braceCount === 0) {
                    switchBody = code.substring(match.index, i + 1);
                    break;
                }
            }
        }
        const caseCount = (switchBody.match(/case\s+/g) || []).length;
        if (caseCount > 3) {
            smells.push({
                type: 'switch_statement',
                name: `Switch na linha ${line}`,
                severity: caseCount > 5 ? 'error' : 'warning',
                location: `${fileName}:${line}`,
                description: `Switch com ${caseCount} cases`,
                recommendation: 'Considere usar polimorfismo, strategy pattern ou map de objetos',
            });
        }
    }
    return smells;
}
function detectLongMethods(code, fileName) {
    const smells = [];
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+\s*)?\{)/g;
    let match;
    while ((match = functionRegex.exec(code)) !== null) {
        const name = match[1] || match[2] || match[3];
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
        const lines = endLine - startLine + 1;
        if (lines > 50) {
            smells.push({
                type: 'long_method',
                name,
                severity: lines > 100 ? 'error' : 'warning',
                location: `${fileName}:${startLine}`,
                description: `Função ${name} tem ${lines} linhas`,
                recommendation: 'Considere extrair lógica em funções menores',
            });
        }
    }
    return smells;
}
function detectDataClumps(code, fileName) {
    const smells = [];
    const functionRegex = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*\w+\s*)?\{)/g;
    const paramGroups = {};
    let match;
    while ((match = functionRegex.exec(code)) !== null) {
        const name = match[1] || match[2] || match[3];
        const params = match[4] || '';
        if (params) {
            const paramList = params.split(',').map(p => p.trim()).filter(p => p);
            for (const param of paramList) {
                const type = param.split(':')[1]?.trim() || 'any';
                if (!paramGroups[type])
                    paramGroups[type] = [];
                paramGroups[type].push(name);
            }
        }
    }
    for (const [type, funcs] of Object.entries(paramGroups)) {
        if (funcs.length > 3) {
            const line = code.substring(0, code.indexOf(funcs[0])).split('\n').length;
            smells.push({
                type: 'data_clump',
                name: `Parâmetros do tipo ${type}`,
                severity: 'warning',
                location: `${fileName}:${line}`,
                description: `${funcs.length} funções compartilham parâmetros do tipo ${type}`,
                recommendation: `Considere criar uma classe para agrupar os parâmetros do tipo ${type}`,
            });
        }
    }
    return smells;
}
export function detectCodeSmells(code, fileName, options) {
    // Check file cache first
    if (options?.fileCache && options.contentHash) {
        const cacheKey = `${fileName}||${options.contentHash}`;
        const cached = options.fileCache.get(cacheKey);
        if (cached)
            return cached;
    }
    // Early return if file doesn't match focusFiles
    if (options?.focusFiles?.length && !fileMatchesFocus(fileName, options.focusFiles)) {
        return { smells: [], summary: { total_smells: 0, by_type: {}, by_severity: {} } };
    }
    const focusSet = options?.focusSmells ? new Set(options.focusSmells) : null;
    const excludeSet = options?.excludeSmells ? new Set(options.excludeSmells) : null;
    const severityOrder = { info: 0, warning: 1, error: 2 };
    const minSeverityLevel = options?.minSeverity ? severityOrder[options.minSeverity] ?? 0 : 0;
    const shouldDetect = (type) => {
        if (excludeSet?.has(type))
            return false;
        if (focusSet && !focusSet.has(type))
            return false;
        return true;
    };
    const detectors = [
        { type: "long_parameter_list", fn: () => detectLongParameterList(code, fileName) },
        { type: "god_class", fn: () => detectGodClass(code, fileName) },
        { type: "feature_envy", fn: () => detectFeatureEnvy(code, fileName) },
        { type: "switch_statement", fn: () => detectSwitchStatements(code, fileName) },
        { type: "long_method", fn: () => detectLongMethods(code, fileName) },
        { type: "data_clump", fn: () => detectDataClumps(code, fileName) },
    ];
    let smells = [];
    for (const detector of detectors) {
        if (shouldDetect(detector.type)) {
            smells.push(...detector.fn());
        }
    }
    // Apply severity filter
    smells = smells.filter(s => (severityOrder[s.severity] ?? 0) >= minSeverityLevel);
    // Apply max results limit
    if (options?.maxResults && smells.length > options.maxResults) {
        smells = smells.slice(0, options.maxResults);
    }
    const byType = {};
    const bySeverity = {};
    for (const smell of smells) {
        byType[smell.type] = (byType[smell.type] || 0) + 1;
        bySeverity[smell.severity] = (bySeverity[smell.severity] || 0) + 1;
    }
    const result = {
        smells,
        summary: {
            total_smells: smells.length,
            by_type: byType,
            by_severity: bySeverity,
        },
    };
    // Store in file cache if provided
    if (options?.fileCache && options.contentHash) {
        const cacheKey = `${fileName}||${options.contentHash}`;
        options.fileCache.set(cacheKey, result);
    }
    return result;
}
export function formatCodeSmellReport(report) {
    const lines = [
        '## Detecção de Code Smells',
        '',
        `**Total:** ${report.summary.total_smells}`,
        '',
    ];
    if (Object.keys(report.summary.by_severity).length > 0) {
        lines.push('### Por Severidade');
        for (const [severity, count] of Object.entries(report.summary.by_severity)) {
            const icon = severity === 'error' ? '❌' : severity === 'warning' ? '⚠️' : 'ℹ️';
            lines.push(`${icon} **${severity}:** ${count}`);
        }
        lines.push('');
    }
    if (Object.keys(report.summary.by_type).length > 0) {
        lines.push('### Por Tipo');
        for (const [type, count] of Object.entries(report.summary.by_type)) {
            lines.push(`- **${type}:** ${count}`);
        }
        lines.push('');
    }
    if (report.smells.length > 0) {
        lines.push('### Problemas Detectados');
        for (const smell of report.smells) {
            const icon = smell.severity === 'error' ? '❌' : smell.severity === 'warning' ? '⚠️' : 'ℹ️';
            lines.push(`${icon} **${smell.type}** (${smell.name})`);
            lines.push(`   - **Local:** ${smell.location}`);
            lines.push(`   - **Descrição:** ${smell.description}`);
            lines.push(`   - **Recomendação:** ${smell.recommendation}`);
            lines.push('');
        }
    }
    else {
        lines.push('✅ Nenhum code smell detectado');
    }
    return lines.join('\n');
}
