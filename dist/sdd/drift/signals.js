import { getNodesByType, getNode } from "../graph/engine.js";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, extname, relative } from "path";
import { projectPath } from "../security/paths.js";
const LAYER_MAP = {
    ".tsx": "frontend",
    ".jsx": "frontend",
    ".vue": "frontend",
    ".svelte": "frontend",
    ".ts": "backend",
    ".js": "backend",
    ".py": "backend",
    ".go": "backend",
    ".rs": "backend",
    ".java": "backend",
    ".rb": "backend",
};
export function detectAllSignals(graph, projectDir, options) {
    const result = {
        mutant_duplicates: [],
        architecture_violations: [],
        pattern_fragmentation: [],
        temporal_volatility: [],
        total_signals: 0,
    };
    result.mutant_duplicates = detectMutantDuplicates(projectDir, options);
    result.architecture_violations = detectArchitectureViolations(graph, projectDir);
    result.pattern_fragmentation = detectPatternFragmentation(graph);
    result.temporal_volatility = detectTemporalVolatility(graph);
    result.total_signals =
        result.mutant_duplicates.length +
            result.architecture_violations.length +
            result.pattern_fragmentation.length +
            result.temporal_volatility.length;
    return result;
}
function detectMutantDuplicates(projectDir, options) {
    const duplicates = [];
    const threshold = options?.similarityThreshold ?? 0.85;
    const MAX_COMPARE_SIZE = 5120; // 5KB cap per file for Levenshtein
    // Build exclusion sets for O(1) lookup
    const excludeSet = new Set(options?.excludeFiles?.map(f => f.replace(/^\.\//, "")) || []);
    const excludePatterns = options?.excludePatterns || [];
    const focusPaths = options?.focusPaths || [];
    // Build set of already-verified pairs to skip
    const verifiedPairs = new Set();
    if (options?.alreadyVerified) {
        for (const pair of options.alreadyVerified) {
            // Normalize and store both orderings
            const a = pair.file_a.replace(/^\.\//, "");
            const b = pair.file_b.replace(/^\.\//, "");
            verifiedPairs.add([a, b].sort().join("|||"));
        }
    }
    // Collect files — either focused or full scan
    let tsFiles;
    if (focusPaths.length > 0) {
        // Focused scan: only scan specified paths
        tsFiles = [];
        for (const fp of focusPaths) {
            const fullPath = projectPath(projectDir, fp);
            if (existsSync(fullPath)) {
                tsFiles.push(fullPath);
            }
            else {
                // Maybe it's a directory — scan it
                tsFiles.push(...collectTsFiles(fullPath));
            }
        }
    }
    else {
        tsFiles = collectTsFiles(projectDir);
    }
    // Pre-read and normalize all files once (avoids repeated I/O)
    const fileData = [];
    for (const filePath of tsFiles) {
        const relPath = relative(projectDir, filePath);
        // Apply exclusions
        if (excludeSet.has(relPath))
            continue;
        if (excludePatterns.some(p => matchesPattern(relPath, p)))
            continue;
        const raw = readFileSafe(filePath);
        if (raw.length < 50)
            continue;
        const content = normalizeCode(raw);
        if (content.length < 50)
            continue;
        const tokens = buildTokenFrequency(content);
        fileData.push({ path: filePath, relPath, content, size: content.length, tokens });
    }
    // Smart comparison: 3-phase filter to minimize Levenshtein calls
    for (let i = 0; i < fileData.length; i++) {
        for (let j = i + 1; j < fileData.length; j++) {
            const a = fileData[i];
            const b = fileData[j];
            // Skip already-verified pairs
            const pairKey = [a.relPath, b.relPath].sort().join("|||");
            if (verifiedPairs.has(pairKey))
                continue;
            // Phase 1: Size-based skip (files >30% different in size are unlikely duplicates)
            const sizeRatio = Math.abs(a.size - b.size) / Math.max(a.size, b.size);
            if (sizeRatio > 0.3)
                continue;
            // Phase 2: Token frequency similarity (O(n) fast check)
            const tokenSim = tokenFrequencySimilarity(a.tokens, b.tokens);
            if (tokenSim < 0.7)
                continue;
            // Phase 3: Levenshtein on capped content (final confirmation)
            const sampleA = a.content.slice(0, MAX_COMPARE_SIZE);
            const sampleB = b.content.slice(0, MAX_COMPARE_SIZE);
            const similarity = levenshteinSimilarity(sampleA, sampleB);
            if (similarity > threshold) {
                duplicates.push({
                    file_a: a.relPath,
                    file_b: b.relPath,
                    similarity: Math.round(similarity * 100) / 100,
                });
            }
        }
    }
    return duplicates;
}
/**
 * Simple pattern matching (supports * wildcard at end of pattern).
 */
function matchesPattern(path, pattern) {
    if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -2);
        return path.startsWith(prefix + "/") || path === prefix;
    }
    if (pattern.endsWith("/**")) {
        const prefix = pattern.slice(0, -3);
        return path.startsWith(prefix + "/") || path === prefix;
    }
    // Exact match
    return path === pattern;
}
function detectArchitectureViolations(graph, projectDir) {
    const violations = [];
    const tsFiles = collectTsFiles(projectDir);
    // ── Build layer maps from Knowledge Graph ─────────────────────────
    // 1. Technology → layer from architecture_component nodes
    const techToLayer = new Map();
    const archNodes = getNodesByType(graph, "architecture_component");
    for (const arch of archNodes) {
        const meta = arch.metadata;
        if (meta.layer && meta.technology) {
            techToLayer.set(meta.technology.toLowerCase(), meta.layer);
        }
    }
    // 2. File path → layer from file nodes in graph
    const fileNodePathToLayer = new Map();
    const fileNodes = getNodesByType(graph, "file");
    for (const fn of fileNodes) {
        const path = fn.metadata.path;
        if (!path)
            continue;
        // Infer layer from path patterns (same as validator.ts)
        const lower = path.toLowerCase();
        if (lower.includes("client") || lower.includes("frontend") || lower.includes("pages/") || lower.includes("components/")) {
            fileNodePathToLayer.set(path, "frontend");
        }
        else if (lower.includes("server") || lower.includes("backend") || lower.includes("routes/") || lower.includes("controllers/") || lower.includes("services/") || lower.includes("repositories/")) {
            fileNodePathToLayer.set(path, "backend");
        }
        else if (lower.includes("database") || lower.includes("migrations/") || lower.includes("schema")) {
            fileNodePathToLayer.set(path, "database");
        }
        else if (lower.includes("shared") || lower.includes("common")) {
            fileNodePathToLayer.set(path, "shared");
        }
    }
    for (const filePath of tsFiles) {
        const content = readFileSafe(filePath);
        const imports = extractImports(content);
        const relPath = relative(projectDir, filePath);
        // Determine source layer: graph file node → path inference → extension fallback
        let fromLayer = fileNodePathToLayer.get(relPath)
            || inferLayerFromPath(relPath)
            || LAYER_MAP[extname(filePath)]
            || "backend";
        for (const imp of imports) {
            // Determine target layer: technology match → path inference → extension fallback
            let toLayer = null;
            // Check if import matches an architecture component technology
            const impLower = imp.toLowerCase();
            for (const [tech, layer] of techToLayer) {
                if (impLower.includes(tech)) {
                    toLayer = layer;
                    break;
                }
            }
            // For relative imports, try to resolve and check file nodes
            if (!toLayer && imp.startsWith(".")) {
                const resolved = resolveImportPath(filePath, imp);
                if (resolved) {
                    const resolvedRel = relative(projectDir, resolved);
                    toLayer = fileNodePathToLayer.get(resolvedRel)
                        || inferLayerFromPath(resolvedRel);
                }
            }
            // Extension fallback (last resort)
            if (!toLayer) {
                const toExt = extname(imp) || extname(resolveImportPath(filePath, imp));
                toLayer = LAYER_MAP[toExt] || "backend";
            }
            if (fromLayer === "frontend" && toLayer === "backend") {
                // Allow known shared/utility patterns
                if (!imp.includes("api") && !imp.includes("shared") && !imp.includes("types") && !imp.includes("common")) {
                    violations.push({
                        file: relPath,
                        import_path: imp,
                        from_layer: fromLayer,
                        to_layer: toLayer,
                    });
                }
            }
        }
    }
    return violations;
}
/**
 * Infer layer from file path patterns (shared logic with validator.ts/smart-validator.ts).
 */
function inferLayerFromPath(path) {
    const p = path.toLowerCase();
    if (p.includes("client") || p.includes("frontend") || p.includes("pages/") || p.includes("components/"))
        return "frontend";
    if (p.includes("server") || p.includes("backend") || p.includes("routes/") || p.includes("controllers/") || p.includes("services/") || p.includes("repositories/"))
        return "backend";
    if (p.includes("database") || p.includes("migrations/") || p.includes("schema"))
        return "database";
    if (p.includes("shared") || p.includes("common"))
        return "shared";
    return null;
}
function detectPatternFragmentation(graph) {
    const fragments = [];
    const entities = getNodesByType(graph, "entity");
    for (const entity of entities) {
        const relatedNodes = graph.relationships
            .filter((r) => r.from === entity.id || r.to === entity.id)
            .map((r) => getNode(graph, r.from === entity.id ? r.to : r.from))
            .filter(Boolean);
        const functionNames = relatedNodes
            .filter((n) => n && (n.type === "symbol" || n.type === "endpoint"))
            .map((n) => n.name);
        const stems = functionNames.map((name) => normalizeFunctionName(name));
        const stemCounts = {};
        for (let i = 0; i < stems.length; i++) {
            const stem = stems[i];
            if (!stemCounts[stem])
                stemCounts[stem] = [];
            stemCounts[stem].push(functionNames[i]);
        }
        for (const [stem, names] of Object.entries(stemCounts)) {
            if (names.length >= 3) {
                fragments.push({
                    entity: entity.name,
                    similar_functions: names,
                    pattern: stem,
                });
            }
        }
    }
    return fragments;
}
function detectTemporalVolatility(graph) {
    const volatile = [];
    const changes = getNodesByType(graph, "change");
    const fileCoOccurrence = {};
    for (const change of changes) {
        const files = change.metadata.affected_files || [];
        for (let i = 0; i < files.length; i++) {
            for (let j = i + 1; j < files.length; j++) {
                const key = [files[i], files[j]].sort().join("|||");
                if (!fileCoOccurrence[key]) {
                    fileCoOccurrence[key] = { count: 0, changeIds: [] };
                }
                fileCoOccurrence[key].count++;
                fileCoOccurrence[key].changeIds.push(change.id);
            }
        }
    }
    for (const [key, data] of Object.entries(fileCoOccurrence)) {
        if (data.count >= 3) {
            const [fileA, fileB] = key.split("|||");
            volatile.push({
                file_a: fileA,
                file_b: fileB,
                co_occurrence_count: data.count,
                change_ids: data.changeIds,
            });
        }
    }
    return volatile.sort((a, b) => b.co_occurrence_count - a.co_occurrence_count).slice(0, 20);
}
function collectTsFiles(dir) {
    const files = [];
    if (!existsSync(dir))
        return files;
    const walk = (d) => {
        const entries = readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isSymbolicLink())
                continue;
            const fullPath = join(d, entry.name);
            if (entry.isDirectory()) {
                if (!entry.name.startsWith(".") && !["node_modules", "dist", "build", "coverage", "target", "vendor"].includes(entry.name)) {
                    walk(fullPath);
                }
            }
            else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
                files.push(fullPath);
            }
        }
    };
    walk(dir);
    return files;
}
function readFileSafe(path) {
    try {
        return readFileSync(path, "utf-8");
    }
    catch {
        return "";
    }
}
function normalizeCode(code) {
    return code
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        // Simplify imports to keep module names (preserves dependency info for duplicate detection)
        .replace(/import\s+\{[^}]*\}\s+from\s+['"]([^'"]+)['"]/g, "import from $1")
        .replace(/import\s+[^\s]+\s+from\s+['"]([^'"]+)['"]/g, "import from $1")
        .replace(/import\s+['"]([^'"]+)['"]/g, "import from $1")
        .replace(/export\s+/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function extractImports(content) {
    const imports = [];
    const importRegex = /import\s+.*from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1]);
    }
    return imports;
}
function resolveImportPath(filePath, importPath) {
    if (importPath.startsWith(".")) {
        const dir = join(filePath, "..");
        return join(dir, importPath);
    }
    return "";
}
function normalizeFunctionName(name) {
    return name
        .replace(/^(get|fetch|load|find|read|query|search)/i, "")
        .replace(/^(set|create|add|insert|write|save|update|delete|remove)/i, "")
        .toLowerCase();
}
function levenshteinSimilarity(a, b) {
    if (a === b)
        return 1;
    if (a.length === 0 || b.length === 0)
        return 0;
    const lenA = a.length;
    const lenB = b.length;
    const maxLen = Math.max(lenA, lenB);
    // Use sampling for very large files to avoid O(m×n) blowup
    if (maxLen > 10000) {
        return quickSimilarity(a, b);
    }
    const matrix = Array.from({ length: lenA + 1 }, () => Array(lenB + 1).fill(0));
    for (let i = 0; i <= lenA; i++)
        matrix[i][0] = i;
    for (let j = 0; j <= lenB; j++)
        matrix[0][j] = j;
    for (let i = 1; i <= lenA; i++) {
        for (let j = 1; j <= lenB; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
        }
    }
    return 1 - matrix[lenA][lenB] / maxLen;
}
/**
 * Build a frequency map of meaningful tokens from code.
 * Used as a fast pre-filter before Levenshtein comparison.
 */
function buildTokenFrequency(code) {
    const freq = new Map();
    // Extract identifiers and keywords (ignore operators/punctuation)
    const tokens = code.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
    for (const token of tokens) {
        const lower = token.toLowerCase();
        freq.set(lower, (freq.get(lower) || 0) + 1);
    }
    return freq;
}
/**
 * Compute cosine-like similarity between two token frequency maps.
 * Returns 0..1 where 1 = identical token distribution.
 * O(n) where n = number of unique tokens.
 */
function tokenFrequencySimilarity(a, b) {
    if (a.size === 0 && b.size === 0)
        return 1;
    if (a.size === 0 || b.size === 0)
        return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    // Iterate over the smaller map for efficiency
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const [token, countA] of smaller) {
        normA += countA * countA;
        const countB = larger.get(token);
        if (countB !== undefined) {
            dotProduct += countA * countB;
        }
    }
    for (const [, countB] of larger) {
        normB += countB * countB;
    }
    if (normA === 0 || normB === 0)
        return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
function quickSimilarity(a, b) {
    const sampleA = a.slice(0, 500);
    const sampleB = b.slice(0, 500);
    return levenshteinSimilarity(sampleA, sampleB);
}
export function formatDriftSignals(signals) {
    const lines = [];
    if (signals.total_signals === 0) {
        return "✅ No drift signals detected.";
    }
    lines.push(`## Drift Signals (${signals.total_signals} total)\n`);
    if (signals.mutant_duplicates.length > 0) {
        lines.push(`### Mutant Duplicates (${signals.mutant_duplicates.length})`);
        for (const d of signals.mutant_duplicates.slice(0, 10)) {
            lines.push(`- ${d.file_a} ↔ ${d.file_b} (${(d.similarity * 100).toFixed(0)}% similar)`);
        }
        lines.push("");
    }
    if (signals.architecture_violations.length > 0) {
        lines.push(`### Architecture Violations (${signals.architecture_violations.length})`);
        for (const v of signals.architecture_violations.slice(0, 10)) {
            lines.push(`- ${v.file}: imports ${v.import_path} (${v.from_layer} → ${v.to_layer})`);
        }
        lines.push("");
    }
    if (signals.pattern_fragmentation.length > 0) {
        lines.push(`### Pattern Fragmentation (${signals.pattern_fragmentation.length})`);
        for (const f of signals.pattern_fragmentation.slice(0, 10)) {
            lines.push(`- ${f.entity}: ${f.similar_functions.join(", ")} (pattern: ${f.pattern})`);
        }
        lines.push("");
    }
    if (signals.temporal_volatility.length > 0) {
        lines.push(`### Temporal Volatility (${signals.temporal_volatility.length})`);
        for (const v of signals.temporal_volatility.slice(0, 10)) {
            lines.push(`- ${v.file_a} ↔ ${v.file_b} (co-occur in ${v.co_occurrence_count} changes)`);
        }
        lines.push("");
    }
    return lines.join("\n");
}
