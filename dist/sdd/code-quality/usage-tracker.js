import { getExclusionSets, isNodeExcludedOrDeprecated } from '../drift/exclusion.js';
const SPEC_NODE_TYPES = [
    'feature', 'entity', 'requirement', 'business_rule',
    'architecture_component', 'module', 'api', 'use_case', 'flow'
];
export function trackUsage(graph, sourceFiles) {
    const files = [];
    const symbols = [];
    const unusedCode = [];
    const { removed, deprecated } = getExclusionSets(graph);
    const fileNodes = graph.nodes.filter(n => n.type === 'file')
        .filter(f => !isNodeExcludedOrDeprecated(f.id, f.status, removed, deprecated));
    const symbolNodes = graph.nodes.filter(n => n.type === 'symbol')
        .filter(s => !isNodeExcludedOrDeprecated(s.id, s.status, removed, deprecated));
    for (const fileNode of fileNodes) {
        const filePath = fileNode.metadata.path;
        const sourceCode = sourceFiles.get(filePath);
        const importUsages = findFileImportersWithUsage(filePath, graph, sourceFiles);
        const usedBy = findFileUsers(filePath, graph);
        const isEntry = detectEntryPoint(filePath, sourceCode || '');
        const specConnections = findSpecConnections(fileNode.id, graph);
        const totalImporters = importUsages.length;
        const effectiveImporters = importUsages.filter(u => u.is_effectively_used).length;
        let status = 'used';
        if (totalImporters === 0 && usedBy.length === 0 && !isEntry) {
            if (specConnections.length > 0) {
                status = 'disconnected';
                unusedCode.push({
                    type: 'file',
                    name: filePath,
                    file_path: filePath,
                    reason: `Arquivo conectado a spec (${specConnections.join(', ')}) mas não importado`,
                    severity: 'info',
                    recommendation: 'CONECTAR: Importe este arquivo. NÃO deletar.',
                    is_connected_to_spec: true,
                    connected_spec_nodes: specConnections,
                });
            }
            else {
                status = 'orphan';
                unusedCode.push({
                    type: 'file',
                    name: filePath,
                    file_path: filePath,
                    reason: 'Arquivo não importado E não conectado a spec',
                    severity: 'warning',
                    recommendation: 'Pode ser removido via sdd.remove_dead_code.',
                    is_connected_to_spec: false,
                    connected_spec_nodes: [],
                });
            }
        }
        else if (totalImporters > 0 && effectiveImporters === 0) {
            status = 'unused';
            for (const usage of importUsages) {
                unusedCode.push({
                    type: 'import',
                    name: filePath,
                    file_path: filePath,
                    reason: `Importado em ${usage.importing_file} mas símbolos não usados`,
                    severity: 'warning',
                    recommendation: 'IMPORT MORTO: Remova o import ou use os símbolos.',
                    is_connected_to_spec: specConnections.length > 0,
                    connected_spec_nodes: specConnections,
                    details: {
                        importing_file: usage.importing_file,
                        imported_symbols: usage.imported_symbols,
                        unused_symbols: usage.unused_imports,
                    },
                });
            }
        }
        files.push({
            file_path: filePath,
            imported_by: importUsages,
            used_by: usedBy,
            is_entry_point: isEntry,
            is_connected_to_spec: specConnections.length > 0,
            connected_spec_nodes: specConnections,
            status,
        });
    }
    for (const symbolNode of symbolNodes) {
        const symbolName = symbolNode.name;
        const filePath = symbolNode.metadata.file_path;
        const symbolType = symbolNode.metadata.symbol_type;
        const importedBy = findSymbolImportersWithUsage(symbolName, filePath, graph, sourceFiles);
        const calledBy = findSymbolCallers(symbolName, filePath, graph);
        const referencedBy = findSymbolReferences(symbolName, filePath, graph);
        const specConnections = findSpecConnections(symbolNode.id, graph);
        const totalImporters = importedBy.length;
        const effectiveImporters = importedBy.filter(u => u.is_effectively_used).length;
        let status = 'used';
        if (totalImporters === 0 && calledBy.length === 0 && referencedBy.length === 0) {
            if (specConnections.length > 0) {
                status = 'disconnected';
                unusedCode.push({
                    type: 'symbol',
                    name: symbolName,
                    file_path: filePath,
                    reason: `Símbolo ${symbolType} conectado a spec (${specConnections.join(', ')}) mas não usado`,
                    severity: 'info',
                    recommendation: `CONECTAR: Use este símbolo. NÃO deletar.`,
                    is_connected_to_spec: true,
                    connected_spec_nodes: specConnections,
                });
            }
            else {
                status = 'dead';
                unusedCode.push({
                    type: 'symbol',
                    name: symbolName,
                    file_path: filePath,
                    reason: `Símbolo ${symbolType} não usado E não conectado a spec`,
                    severity: 'warning',
                    recommendation: `Considere remover ${symbolType}`,
                    is_connected_to_spec: false,
                    connected_spec_nodes: [],
                });
            }
        }
        else if (totalImporters > 0 && effectiveImporters === 0 && calledBy.length === 0 && referencedBy.length === 0) {
            status = 'unused';
            for (const usage of importedBy) {
                unusedCode.push({
                    type: 'import',
                    name: symbolName,
                    file_path: filePath,
                    reason: `Símbolo ${symbolType} importado em ${usage.importing_file} mas não chamado`,
                    severity: 'warning',
                    recommendation: 'IMPORT MORTO: Símbolo importado mas nunca chamado.',
                    is_connected_to_spec: specConnections.length > 0,
                    connected_spec_nodes: specConnections,
                    details: {
                        importing_file: usage.importing_file,
                        imported_symbols: [symbolName],
                        unused_symbols: usage.unused_imports.includes(symbolName) ? [symbolName] : [],
                    },
                });
            }
        }
        symbols.push({
            symbol_name: symbolName,
            file_path: filePath,
            symbol_type: symbolType,
            imported_by: importedBy,
            called_by: calledBy,
            referenced_by: referencedBy,
            is_connected_to_spec: specConnections.length > 0,
            connected_spec_nodes: specConnections,
            status,
        });
    }
    const usedFiles = files.filter(f => f.status === 'used').length;
    const unusedFiles = files.filter(f => f.status === 'orphan').length;
    const usedSymbols = symbols.filter(s => s.status === 'used').length;
    const unusedSymbols = symbols.filter(s => s.status === 'dead').length;
    return {
        files,
        symbols,
        summary: {
            total_files: files.length,
            used_files: usedFiles,
            unused_files: unusedFiles,
            total_symbols: symbols.length,
            used_symbols: usedSymbols,
            unused_symbols: unusedSymbols,
        },
        unused_code: unusedCode,
    };
}
function findFileImportersWithUsage(filePath, graph, sourceFiles) {
    const importUsages = [];
    const fileNodes = graph.nodes.filter(n => n.type === 'file');
    for (const fileNode of fileNodes) {
        const importingFilePath = fileNode.metadata.path;
        if (importingFilePath === filePath)
            continue;
        const importingCode = sourceFiles.get(importingFilePath);
        if (!importingCode)
            continue;
        const importedSymbols = extractImportsFromFile(importingCode, filePath);
        if (importedSymbols.length === 0)
            continue;
        const actuallyUsed = importedSymbols.filter(sym => isSymbolUsedInCode(sym, importingCode));
        const unusedImports = importedSymbols.filter(sym => !isSymbolUsedInCode(sym, importingCode));
        importUsages.push({
            importing_file: importingFilePath,
            imported_symbols: importedSymbols,
            actually_used_symbols: actuallyUsed,
            unused_imports: unusedImports,
            is_effectively_used: actuallyUsed.length > 0,
        });
    }
    return importUsages;
}
function findSymbolImportersWithUsage(symbolName, filePath, graph, sourceFiles) {
    const importUsages = [];
    const fileNodes = graph.nodes.filter(n => n.type === 'file');
    for (const fileNode of fileNodes) {
        const importingFilePath = fileNode.metadata.path;
        if (importingFilePath === filePath)
            continue;
        const importingCode = sourceFiles.get(importingFilePath);
        if (!importingCode)
            continue;
        const importedSymbols = extractNamedImportsFromFile(importingCode, filePath);
        if (!importedSymbols.includes(symbolName))
            continue;
        const isUsed = isSymbolUsedInCode(symbolName, importingCode);
        importUsages.push({
            importing_file: importingFilePath,
            imported_symbols: [symbolName],
            actually_used_symbols: isUsed ? [symbolName] : [],
            unused_imports: isUsed ? [] : [symbolName],
            is_effectively_used: isUsed,
        });
    }
    return importUsages;
}
function extractImportsFromFile(sourceCode, targetFilePath) {
    const symbols = [];
    const lines = sourceCode.split('\n');
    const targetName = targetFilePath.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/, '') || '';
    for (const line of lines) {
        const importMatch = line.match(/import\s+(?:type\s+)?(?:{([^}]+)}|(\w+))\s+from\s+['"]([^'"]+)['"]/);
        if (!importMatch)
            continue;
        const importPath = importMatch[3];
        if (!importPath.includes(targetName) && !importPath.endsWith(targetFilePath))
            continue;
        if (importMatch[1]) {
            const namedImports = importMatch[1].split(',').map(s => s.trim().split(' as ')[0].trim());
            symbols.push(...namedImports);
        }
        if (importMatch[2]) {
            symbols.push(importMatch[2]);
        }
    }
    return symbols;
}
function extractNamedImportsFromFile(sourceCode, targetFilePath) {
    return extractImportsFromFile(sourceCode, targetFilePath);
}
function isSymbolUsedInCode(symbolName, code) {
    const lines = code.split('\n');
    let foundImportLine = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`import`) && lines[i].includes(symbolName)) {
            foundImportLine = i;
            break;
        }
    }
    if (foundImportLine === -1)
        return false;
    for (let i = foundImportLine + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('import '))
            continue;
        const usageRegex = new RegExp(`\\b${symbolName}\\b`);
        if (usageRegex.test(line)) {
            return true;
        }
    }
    return false;
}
function findFileUsers(filePath, graph) {
    const users = [];
    const relationships = graph.relationships.filter(r => r.to === filePath && ['calls', 'instantiates', 'extends'].includes(r.type));
    for (const rel of relationships) {
        const node = graph.nodes.find(n => n.id === rel.from);
        if (node)
            users.push(node.name);
    }
    return users;
}
function findSymbolCallers(symbolName, filePath, graph) {
    const callers = [];
    const symbolNode = graph.nodes.find(n => n.type === 'symbol' && n.name === symbolName && n.metadata.file_path === filePath);
    if (!symbolNode)
        return callers;
    const relationships = graph.relationships.filter(r => r.to === symbolNode.id && ['calls', 'invokes'].includes(r.type));
    for (const rel of relationships) {
        const node = graph.nodes.find(n => n.id === rel.from);
        if (node)
            callers.push(node.name);
    }
    return callers;
}
function findSymbolReferences(symbolName, filePath, graph) {
    const references = [];
    const symbolNode = graph.nodes.find(n => n.type === 'symbol' && n.name === symbolName && n.metadata.file_path === filePath);
    if (!symbolNode)
        return references;
    const relationships = graph.relationships.filter(r => r.to === symbolNode.id && ['references', 'accesses'].includes(r.type));
    for (const rel of relationships) {
        const node = graph.nodes.find(n => n.id === rel.from);
        if (node)
            references.push(node.name);
    }
    return references;
}
function findSpecConnections(nodeId, graph) {
    const connectedSpecs = [];
    const outgoingRels = graph.relationships.filter(r => r.from === nodeId);
    for (const rel of outgoingRels) {
        const targetNode = graph.nodes.find(n => n.id === rel.to);
        if (targetNode && SPEC_NODE_TYPES.includes(targetNode.type)) {
            connectedSpecs.push(`${targetNode.type}:${targetNode.name}`);
        }
    }
    const incomingRels = graph.relationships.filter(r => r.to === nodeId);
    for (const rel of incomingRels) {
        const sourceNode = graph.nodes.find(n => n.id === rel.from);
        if (sourceNode && SPEC_NODE_TYPES.includes(sourceNode.type)) {
            connectedSpecs.push(`${sourceNode.type}:${sourceNode.name}`);
        }
    }
    return [...new Set(connectedSpecs)];
}
function detectEntryPoint(filePath, sourceCode) {
    if (filePath.endsWith('main.ts') || filePath.endsWith('main.js'))
        return true;
    if (filePath.endsWith('index.ts') || filePath.endsWith('index.js'))
        return true;
    if (filePath.includes('app.ts') || filePath.includes('app.js'))
        return true;
    if (filePath.includes('server.ts') || filePath.includes('server.js'))
        return true;
    if (sourceCode.includes('createApp') || sourceCode.includes('createServer'))
        return true;
    if (sourceCode.includes('bootstrap') || sourceCode.includes('main()'))
        return true;
    return false;
}
export function formatUsageReport(report) {
    const lines = [
        '## Relatório de Uso de Código',
        '',
        '### Resumo',
        `- **Arquivos Totais:** ${report.summary.total_files}`,
        `- **Arquivos Efetivamente Usados:** ${report.summary.used_files}`,
        `- **Arquivos Sem Uso Real:** ${report.summary.unused_files}`,
        `- **Símbolos Totais:** ${report.summary.total_symbols}`,
        `- **Símbolos Efetivamente Usados:** ${report.summary.used_symbols}`,
        `- **Símbolos Sem Uso Real:** ${report.summary.unused_symbols}`,
        '',
    ];
    const importsMortos = report.unused_code.filter(u => u.type === 'import');
    const desconectados = report.unused_code.filter(u => u.type !== 'import' && u.is_connected_to_spec);
    const orfaos = report.unused_code.filter(u => u.type !== 'import' && !u.is_connected_to_spec);
    if (importsMortos.length > 0) {
        lines.push('### 🔴 IMPORTS MORTOS (importado mas NÃO usado)');
        lines.push('⚠️ Estes imports existem mas os símbolos nunca são chamados/referenciados');
        lines.push('');
        for (const item of importsMortos) {
            lines.push(`❌ **${item.name}**`);
            lines.push(`   - **Arquivo que importa:** ${item.details?.importing_file || 'N/A'}`);
            lines.push(`   - **Símbolos importados:** ${item.details?.imported_symbols?.join(', ') || 'N/A'}`);
            lines.push(`   - **Símbolos NÃO usados:** ${item.details?.unused_symbols?.join(', ') || 'todos'}`);
            lines.push(`   - **Ação:** ${item.recommendation}`);
            lines.push('');
        }
    }
    if (desconectados.length > 0) {
        lines.push('### 🔌 DESCONECTADOS (tem spec mas não é importado)');
        for (const item of desconectados) {
            lines.push(`ℹ️ **${item.type}:** ${item.name}`);
            lines.push(`   - **Spec:** ${item.connected_spec_nodes.join(', ')}`);
            lines.push(`   - **Ação:** ${item.recommendation}`);
        }
        lines.push('');
    }
    if (orfaos.length > 0) {
        lines.push('### ⚠️ ÓRFÃOS (sem spec e sem uso)');
        for (const item of orfaos) {
            lines.push(`⚠️ **${item.type}:** ${item.name}`);
            lines.push(`   - **Motivo:** ${item.reason}`);
            lines.push(`   - **Ação:** ${item.recommendation}`);
        }
        lines.push('');
    }
    if (importsMortos.length === 0 && desconectados.length === 0 && orfaos.length === 0) {
        lines.push('✅ Todo código é efetivamente usado e conectado ao SDD.');
    }
    lines.push('');
    lines.push('### Arquivos com Mais Imports Mortos');
    const filesWithDeadImports = report.files
        .filter(f => f.imported_by.some(i => !i.is_effectively_used))
        .sort((a, b) => {
        const aDead = a.imported_by.filter(i => !i.is_effectively_used).length;
        const bDead = b.imported_by.filter(i => !i.is_effectively_used).length;
        return bDead - aDead;
    })
        .slice(0, 5);
    for (const file of filesWithDeadImports) {
        const deadImports = file.imported_by.filter(i => !i.is_effectively_used);
        lines.push(`- **${file.file_path}:** ${deadImports.length} imports mortos`);
    }
    return lines.join('\n');
}
