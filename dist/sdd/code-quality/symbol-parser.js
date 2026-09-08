export function parseSymbols(sourceCode, filePath) {
    const symbols = [];
    const lines = sourceCode.split('\n');
    parseFunctions(lines, filePath, symbols);
    parseClasses(lines, filePath, symbols);
    parseInterfaces(lines, filePath, symbols);
    parseTypes(lines, filePath, symbols);
    parseVariables(lines, filePath, symbols);
    const summary = {
        total: symbols.length,
        functions: symbols.filter(s => s.symbol_type === 'function').length,
        classes: symbols.filter(s => s.symbol_type === 'class').length,
        interfaces: symbols.filter(s => s.symbol_type === 'interface').length,
        types: symbols.filter(s => s.symbol_type === 'type').length,
        methods: symbols.filter(s => s.symbol_type === 'method').length,
        variables: symbols.filter(s => s.symbol_type === 'variable').length,
    };
    return { symbols, summary };
}
function parseFunctions(lines, filePath, symbols) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const funcMatch = line.match(/^(?:(export|public|private|protected)\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*(\S+))?/);
        if (funcMatch) {
            const visibility = funcMatch[1] === 'export' ? 'exported' :
                funcMatch[1] === 'private' ? 'private' :
                    funcMatch[1] === 'protected' ? 'protected' : 'public';
            const isAsync = line.includes('async');
            const params = funcMatch[3] ? funcMatch[3].split(',').map(p => p.trim()) : [];
            const returnType = funcMatch[4];
            const endLine = findClosingBrace(lines, i);
            symbols.push({
                name: funcMatch[2],
                symbol_type: 'function',
                file_path: filePath,
                line_start: i + 1,
                line_end: endLine + 1,
                visibility,
                is_async: isAsync,
                parameters: params,
                return_type: returnType,
            });
        }
        const arrowMatch = line.match(/^(?:(export|public|private|protected)\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\([^)]*\)\s*:\s*\S+)?\s*=\s*(?:async\s*)?\(/);
        if (arrowMatch && !line.includes('=>')) {
            const visibility = arrowMatch[1] === 'export' ? 'exported' :
                arrowMatch[1] === 'private' ? 'private' :
                    arrowMatch[1] === 'protected' ? 'protected' : 'public';
            const isAsync = line.includes('async');
            const endLine = findClosingBrace(lines, i);
            symbols.push({
                name: arrowMatch[2],
                symbol_type: 'function',
                file_path: filePath,
                line_start: i + 1,
                line_end: endLine + 1,
                visibility,
                is_async: isAsync,
            });
        }
    }
}
function parseClasses(lines, filePath, symbols) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const classMatch = line.match(/^(?:(export|public|private|protected)\s+)?(?:abstract\s+)?class\s+(\w+)/);
        if (classMatch) {
            const visibility = classMatch[1] === 'export' ? 'exported' :
                classMatch[1] === 'private' ? 'private' :
                    classMatch[1] === 'protected' ? 'protected' : 'public';
            const endLine = findClosingBrace(lines, i);
            symbols.push({
                name: classMatch[2],
                symbol_type: 'class',
                file_path: filePath,
                line_start: i + 1,
                line_end: endLine + 1,
                visibility,
                is_async: false,
            });
            parseMethods(lines, i, endLine, filePath, classMatch[2], symbols);
        }
    }
}
function parseMethods(lines, classStart, classEnd, filePath, className, symbols) {
    for (let i = classStart; i <= classEnd && i < lines.length; i++) {
        const line = lines[i];
        const methodMatch = line.match(/^\s+(?:(public|private|protected|static)\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*(\S+))?/);
        if (methodMatch && !['if', 'else', 'for', 'while', 'switch', 'return', 'import', 'export'].includes(methodMatch[2])) {
            const visibility = methodMatch[1] === 'private' ? 'private' :
                methodMatch[1] === 'protected' ? 'protected' : 'public';
            const isAsync = line.includes('async');
            const params = methodMatch[3] ? methodMatch[3].split(',').map(p => p.trim()) : [];
            const returnType = methodMatch[4];
            const endLine = findClosingBrace(lines, i);
            symbols.push({
                name: `${className}.${methodMatch[2]}`,
                symbol_type: 'method',
                file_path: filePath,
                line_start: i + 1,
                line_end: endLine + 1,
                visibility,
                is_async: isAsync,
                parameters: params,
                return_type: returnType,
            });
        }
    }
}
function parseInterfaces(lines, filePath, symbols) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const interfaceMatch = line.match(/^(?:(export)\s+)?interface\s+(\w+)/);
        if (interfaceMatch) {
            const visibility = interfaceMatch[1] === 'export' ? 'exported' : 'public';
            const endLine = findClosingBrace(lines, i);
            symbols.push({
                name: interfaceMatch[2],
                symbol_type: 'interface',
                file_path: filePath,
                line_start: i + 1,
                line_end: endLine + 1,
                visibility,
                is_async: false,
            });
        }
    }
}
function parseTypes(lines, filePath, symbols) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const typeMatch = line.match(/^(?:(export)\s+)?type\s+(\w+)/);
        if (typeMatch) {
            const visibility = typeMatch[1] === 'export' ? 'exported' : 'public';
            symbols.push({
                name: typeMatch[2],
                symbol_type: 'type',
                file_path: filePath,
                line_start: i + 1,
                line_end: i + 1,
                visibility,
                is_async: false,
            });
        }
    }
}
function parseVariables(lines, filePath, symbols) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const varMatch = line.match(/^(?:(export)\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*(\S+))?/);
        if (varMatch && !line.includes('=') && !line.includes('=>')) {
            const visibility = varMatch[1] === 'export' ? 'exported' : 'public';
            symbols.push({
                name: varMatch[2],
                symbol_type: 'variable',
                file_path: filePath,
                line_start: i + 1,
                line_end: i + 1,
                visibility,
                is_async: false,
            });
        }
    }
}
function findClosingBrace(lines, startLine) {
    let braceCount = 0;
    let inFunction = false;
    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i];
        for (const char of line) {
            if (char === '{') {
                braceCount++;
                inFunction = true;
            }
            else if (char === '}') {
                braceCount--;
                if (inFunction && braceCount === 0) {
                    return i;
                }
            }
        }
    }
    return lines.length - 1;
}
export function convertToSymbolNodes(result) {
    return result.symbols.map(symbol => ({
        id: `symbol-${symbol.file_path}-${symbol.name}-${symbol.line_start}`,
        type: 'symbol',
        name: symbol.name,
        status: 'DRAFT',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
            symbol_type: symbol.symbol_type,
            file_path: symbol.file_path,
            line_start: symbol.line_start,
            line_end: symbol.line_end,
        },
    }));
}
export function formatSymbolParseResult(result) {
    const lines = [
        '## Símbolos Extraídos',
        '',
        '### Resumo',
        `- **Total:** ${result.summary.total}`,
        `- **Funções:** ${result.summary.functions}`,
        `- **Classes:** ${result.summary.classes}`,
        `- **Interfaces:** ${result.summary.interfaces}`,
        `- **Tipos:** ${result.summary.types}`,
        `- **Métodos:** ${result.summary.methods}`,
        `- **Variáveis:** ${result.summary.variables}`,
        '',
    ];
    if (result.symbols.length > 0) {
        lines.push('### Símbolos');
        for (const symbol of result.symbols) {
            const asyncTag = symbol.is_async ? ' (async)' : '';
            const params = symbol.parameters ? `(${symbol.parameters.join(', ')})` : '';
            const returnType = symbol.return_type ? `: ${symbol.return_type}` : '';
            lines.push(`- **${symbol.name}** (${symbol.symbol_type}${asyncTag})${params}${returnType}`);
            lines.push(`  - Arquivo: ${symbol.file_path}`);
            lines.push(`  - Linhas: ${symbol.line_start}-${symbol.line_end}`);
            lines.push(`  - Visibilidade: ${symbol.visibility}`);
        }
    }
    return lines.join('\n');
}
