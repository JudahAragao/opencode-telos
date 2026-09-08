export function analyzeImports(sourceCode, filePath, options) {
    const imports = [];
    const exports = [];
    const issues = [];
    const lines = sourceCode.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        const importMatch = line.match(/import\s+(?:(\w+)\s*,?\s*)?(?:{([^}]+)}\s*)?(?:,\s*{([^}]+)}\s*)?\s+from\s+['"]([^'"]+)['"]/g);
        if (importMatch) {
            const defaultMatch = line.match(/import\s+(\w+)\s*,/);
            const namedMatch = line.match(/import\s+{([^}]+)}/);
            const sourceMatch = line.match(/from\s+['"]([^'"]+)['"]/);
            if (sourceMatch) {
                const source = sourceMatch[1];
                const importedNames = [];
                if (defaultMatch) {
                    importedNames.push(defaultMatch[1]);
                    imports.push({
                        source,
                        imported_names: [defaultMatch[1]],
                        is_default: true,
                        is_namespace: false,
                        line: lineNum,
                    });
                }
                if (namedMatch) {
                    const names = namedMatch[1].split(',').map(n => n.trim()).filter(n => n);
                    importedNames.push(...names);
                    imports.push({
                        source,
                        imported_names: names,
                        is_default: false,
                        is_namespace: false,
                        line: lineNum,
                    });
                }
                if (line.includes('* as')) {
                    const namespaceMatch = line.match(/\*\s+as\s+(\w+)/);
                    if (namespaceMatch) {
                        importedNames.push(namespaceMatch[1]);
                        imports.push({
                            source,
                            imported_names: [namespaceMatch[1]],
                            is_default: false,
                            is_namespace: true,
                            line: lineNum,
                        });
                    }
                }
            }
        }
        const exportMatch = line.match(/export\s+(?:default\s+|const\s+|function\s+|class\s+|interface\s+|type\s+|enum\s+)?(\w+)/);
        if (exportMatch) {
            const isDefault = line.includes('export default');
            exports.push({
                name: exportMatch[1],
                type: isDefault ? 'default' : 'named',
                line: lineNum,
            });
        }
        if (line.match(/export\s+{([^}]+)}/)) {
            const namesMatch = line.match(/export\s+{([^}]+)}/);
            if (namesMatch) {
                const names = namesMatch[1].split(',').map(n => n.trim()).filter(n => n);
                for (const name of names) {
                    exports.push({
                        name,
                        type: 'named',
                        line: lineNum,
                    });
                }
            }
        }
        if (line.match(/export\s+\*\s+from/)) {
            const reexportMatch = line.match(/export\s+\*\s+from\s+['"]([^'"]+)['"]/);
            if (reexportMatch) {
                exports.push({
                    name: `* from ${reexportMatch[1]}`,
                    type: 'reexport',
                    line: lineNum,
                });
            }
        }
    }
    const dependencies = imports.map(i => i.source);
    const externalDeps = dependencies.filter(d => !d.startsWith('.') && !d.startsWith('/'));
    const internalDeps = dependencies.filter(d => d.startsWith('.') || d.startsWith('/'));
    // Filter by focus/exclude modules
    const filteredImports = filterImports(imports, options);
    detectImportIssues(sourceCode, filteredImports, exports, filePath, issues);
    return {
        file_path: filePath,
        imports,
        exports,
        dependencies,
        summary: {
            total_imports: imports.length,
            total_exports: exports.length,
            external_deps: externalDeps,
            internal_deps: internalDeps,
        },
        issues,
    };
}
function detectImportIssues(sourceCode, imports, _exports, filePath, issues) {
    for (const imp of imports) {
        if (imp.source.includes('/index') || imp.source.endsWith('/')) {
            issues.push({
                type: 'barrel_import',
                severity: 'warning',
                message: `Importação de barrel file: ${imp.source}`,
                line: imp.line,
            });
        }
        const depth = imp.source.split('/').length - 1;
        if (depth > 3) {
            issues.push({
                type: 'deep_import',
                severity: 'warning',
                message: `Importação profunda (nível ${depth}): ${imp.source}`,
                line: imp.line,
            });
        }
        for (const name of imp.imported_names) {
            const usageRegex = new RegExp(`\\b${name}\\b`, 'g');
            const usages = sourceCode.match(usageRegex);
            if (!usages || usages.length <= 1) {
                issues.push({
                    type: 'unused_import',
                    severity: 'warning',
                    message: `Import não utilizado: ${name} de ${imp.source}`,
                    line: imp.line,
                });
            }
        }
    }
    const localImports = imports.filter(i => i.source.startsWith('.'));
    for (const imp of localImports) {
        const targetPath = resolveRelativePath(filePath, imp.source);
        if (targetPath === filePath) {
            issues.push({
                type: 'circular',
                severity: 'error',
                message: `Dependência circular detectada: ${imp.source}`,
                line: imp.line,
            });
        }
    }
}
function resolveRelativePath(from, relative) {
    const fromParts = from.split('/').slice(0, -1);
    const relParts = relative.split('/');
    for (const part of relParts) {
        if (part === '..') {
            fromParts.pop();
        }
        else if (part !== '.') {
            fromParts.push(part);
        }
    }
    return fromParts.join('/');
}
/** Filter imports by focus/exclude module patterns. */
function filterImports(imports, options) {
    if (!options?.focusModules?.length && !options?.excludeModules?.length)
        return imports;
    return imports.filter((imp) => {
        if (options.excludeModules?.length) {
            if (options.excludeModules.some((m) => imp.source.includes(m)))
                return false;
        }
        if (options.focusModules?.length) {
            return options.focusModules.some((m) => imp.source.includes(m));
        }
        return true;
    });
}
export function formatImportAnalysis(analysis) {
    const lines = [
        `## Análise de Imports - ${analysis.file_path}`,
        '',
        '### Resumo',
        `- **Imports:** ${analysis.summary.total_imports}`,
        `- **Exports:** ${analysis.summary.total_exports}`,
        `- **Deps Externas:** ${analysis.summary.external_deps.length}`,
        `- **Deps Internas:** ${analysis.summary.internal_deps.length}`,
        '',
    ];
    if (analysis.issues.length > 0) {
        lines.push('### ⚠️ Problemas Detectados');
        for (const issue of analysis.issues) {
            const icon = issue.severity === 'error' ? '❌' : '⚠️';
            lines.push(`${icon} **${issue.type}:** ${issue.message}${issue.line ? ` (linha ${issue.line})` : ''}`);
        }
        lines.push('');
    }
    if (analysis.imports.length > 0) {
        lines.push('### Imports');
        for (const imp of analysis.imports) {
            lines.push(`- **${imp.source}:** ${imp.imported_names.join(', ')}`);
        }
        lines.push('');
    }
    if (analysis.exports.length > 0) {
        lines.push('### Exports');
        for (const exp of analysis.exports) {
            lines.push(`- **${exp.name}** (${exp.type})`);
        }
    }
    return lines.join('\n');
}
