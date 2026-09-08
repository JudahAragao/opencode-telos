import { getNode, getNodesByType } from "../graph/engine.js";
import { existsSync, readFileSync } from "fs";
import { projectPath } from "../security/paths.js";
import { detectAllSignals, formatDriftSignals } from "./signals.js";
import { getExclusionSets, isNodeExcludedOrDeprecated, isFileWhitelistedPattern } from "./exclusion.js";
import { hasPersistenceMapping } from "../validation/validator.js";
import { validateGraphIntegrity } from "../graph/integrity-guard.js";
import { parseWithCache, loadAstCache, saveAstCache } from "../../code-intelligence/ast/cache.js";
export function detectDrift(graph, projectDir, options) {
    const result = {
        has_drift: false,
        missing_files: [],
        untracked_files: [],
        spec_code_mismatches: [],
    };
    // Pre-compute sets of nodes that should be excluded from drift detection.
    // Nodes removed via ChangeNode or deprecated should NOT trigger drift.
    const { removed: removedNodeIds, deprecated: deprecatedNodeIds } = getExclusionSets(graph);
    detectMissingFiles(graph, projectDir, result, removedNodeIds, deprecatedNodeIds);
    detectUntrackedFiles(graph, projectDir, result, removedNodeIds, deprecatedNodeIds);
    detectSpecCodeMismatches(graph, projectDir, result, removedNodeIds, deprecatedNodeIds);
    detectAstFileMismatches(graph, projectDir, result, removedNodeIds, deprecatedNodeIds);
    // Filter out whitelisted files from drift results
    result.missing_files = result.missing_files.filter((f) => !isFileWhitelistedPattern(projectDir, f.file_path));
    result.untracked_files = result.untracked_files.filter((f) => !isFileWhitelistedPattern(projectDir, f.file_path));
    result.spec_code_mismatches = result.spec_code_mismatches.filter((m) => !isFileWhitelistedPattern(projectDir, m.node_id));
    // Anti-bypass: check for out-of-band graph modifications
    try {
        const tamperResult = validateGraphIntegrity(projectDir, graph);
        if (tamperResult.tampered) {
            result.spec_code_mismatches.push({
                node_id: "__tamper__",
                description: tamperResult.reason || "Graph modified outside SDD workflow",
                severity: "high",
            });
        }
    }
    catch (error) {
        result.spec_code_mismatches.push({
            node_id: "__integrity_check__",
            description: `Graph integrity validation could not be completed: ${error instanceof Error ? error.message : String(error)}`,
            severity: "high",
        });
    }
    // Re-evaluate has_drift after filtering
    result.has_drift =
        result.missing_files.length > 0 ||
            result.untracked_files.length > 0 ||
            result.spec_code_mismatches.length > 0 ||
            (result.signals?.total_signals ?? 0) > 0;
    const signals = detectAllSignals(graph, projectDir, options);
    // Filter out whitelisted architecture violations from signals
    signals.architecture_violations = signals.architecture_violations.filter((v) => !isFileWhitelistedPattern(projectDir, v.file));
    // Recalculate total_signals after filtering
    signals.total_signals =
        signals.mutant_duplicates.length +
            signals.architecture_violations.length +
            signals.pattern_fragmentation.length +
            signals.temporal_volatility.length;
    result.signals = signals;
    result.has_drift =
        result.missing_files.length > 0 ||
            result.untracked_files.length > 0 ||
            result.spec_code_mismatches.length > 0 ||
            signals.total_signals > 0;
    return result;
}
/** Compare persisted AST evidence with the current source without executing it. */
function detectAstFileMismatches(graph, projectDir, result, removedNodeIds, deprecatedNodeIds) {
    const cache = loadAstCache(projectDir);
    const fileNodes = getNodesByType(graph, "file");
    for (const fileNode of fileNodes) {
        if (isNodeExcludedOrDeprecated(fileNode.id, fileNode.status, removedNodeIds, deprecatedNodeIds))
            continue;
        const filePath = fileNode.metadata.path;
        if (!filePath || !existsSync(projectPath(projectDir, filePath)))
            continue;
        try {
            const fullPath = projectPath(projectDir, filePath);
            const content = readFileSync(fullPath, "utf-8");
            const parsed = parseWithCache(projectDir, fullPath, content, cache);
            const metadata = fileNode.metadata;
            if (typeof metadata.content_hash === "string" && metadata.content_hash !== parsed.content_hash) {
                result.spec_code_mismatches.push({ node_id: fileNode.id, description: `AST content fingerprint changed for ${filePath}`, severity: "high" });
            }
            const expected = Array.isArray(metadata.expected_symbols) ? metadata.expected_symbols : Array.isArray(metadata.symbols) ? metadata.symbols : [];
            if (expected.length > 0) {
                const actual = new Set(parsed.symbols.map((symbol) => symbol.qualified_name));
                for (const value of expected) {
                    if (typeof value === "string" && !actual.has(value))
                        result.spec_code_mismatches.push({ node_id: fileNode.id, description: `Expected AST symbol ${value} is missing from ${filePath}`, severity: "high" });
                }
            }
            if (parsed.analysis_source === "fallback")
                result.spec_code_mismatches.push({ node_id: fileNode.id, description: `File ${filePath} was analyzed with a low-confidence fallback parser`, severity: "low" });
        }
        catch (error) {
            result.spec_code_mismatches.push({ node_id: fileNode.id, description: `Could not parse ${filePath}: ${error instanceof Error ? error.message : String(error)}`, severity: "medium" });
        }
    }
    saveAstCache(projectDir, cache);
}
function detectMissingFiles(graph, projectDir, result, removedNodeIds, deprecatedNodeIds) {
    const fileNodes = getNodesByType(graph, "file");
    for (const fileNode of fileNodes) {
        // Skip files that were removed by a completed change or deprecated
        if (isNodeExcludedOrDeprecated(fileNode.id, fileNode.status, removedNodeIds, deprecatedNodeIds))
            continue;
        const filePath = fileNode.metadata.path;
        if (!filePath)
            continue;
        const fullPath = projectPath(projectDir, filePath);
        if (existsSync(fullPath))
            continue;
        // ── Fuzzy path matching: try to find the file in nearby locations ──
        const fuzzyMatch = findFuzzyPathMatch(filePath, projectDir);
        if (fuzzyMatch) {
            // File exists but in a different path — suggest auto-heal
            result.missing_files.push({
                node_id: fileNode.id,
                file_path: filePath,
                expected_by: `File node ${fileNode.id} (exists at: ${fuzzyMatch} — consider updating path)`,
            });
        }
        else {
            result.missing_files.push({
                node_id: fileNode.id,
                file_path: filePath,
                expected_by: `File node ${fileNode.id}`,
            });
        }
    }
    // Also check task-referenced files
    const taskNodes = graph.nodes.filter((n) => n.type === "task");
    for (const task of taskNodes) {
        // Skip tasks removed by a completed change or deprecated
        if (isNodeExcludedOrDeprecated(task.id, task.status, removedNodeIds, deprecatedNodeIds))
            continue;
        const meta = task.metadata;
        if (Array.isArray(meta.files)) {
            for (const file of meta.files) {
                if (typeof file === "string") {
                    const fullPath = projectPath(projectDir, file);
                    if (!existsSync(fullPath)) {
                        result.missing_files.push({
                            node_id: task.id,
                            file_path: file,
                            expected_by: `Task ${task.id}`,
                        });
                    }
                }
            }
        }
    }
}
function detectUntrackedFiles(graph, projectDir, result, removedNodeIds, deprecatedNodeIds) {
    const trackedPaths = new Set();
    const fileNodes = getNodesByType(graph, "file");
    for (const fn of fileNodes) {
        // Skip files removed by change or deprecated — their paths should NOT
        // be added to trackedPaths, so if the file still exists on disk it
        // will correctly appear as untracked (or be handled by change nodes).
        if (isNodeExcludedOrDeprecated(fn.id, fn.status, removedNodeIds, deprecatedNodeIds))
            continue;
        if (fn.metadata.path)
            trackedPaths.add(fn.metadata.path);
    }
    const taskNodes = graph.nodes.filter((n) => n.type === "task");
    for (const task of taskNodes) {
        if (isNodeExcludedOrDeprecated(task.id, task.status, removedNodeIds, deprecatedNodeIds))
            continue;
        const meta = task.metadata;
        if (Array.isArray(meta.files)) {
            for (const f of meta.files) {
                if (typeof f === "string")
                    trackedPaths.add(f);
            }
        }
    }
    // Only track files from DRAFT/PROPOSED/APPROVED changes (pending changes)
    // COMPLETED changes already had their affected files processed
    const changeNodes = graph.nodes.filter((n) => n.type === "change");
    for (const change of changeNodes) {
        if (["DRAFT", "PROPOSED", "APPROVED"].includes(change.status)) {
            if (change.metadata.affected_files) {
                for (const f of change.metadata.affected_files) {
                    trackedPaths.add(f);
                }
            }
        }
    }
    const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".vue", ".svelte"];
    const excludePatterns = ["node_modules", ".sdd", "dist", "build", ".git", ".opencode", "__pycache__", "vendor"];
    function scanDirectory(dir, relativePath = "") {
        let entries;
        try {
            entries = require("fs").readdirSync(dir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (excludePatterns.some(p => entry === p || entry.startsWith(p)))
                continue;
            const fullPath = `${dir}/${entry}`;
            const relPath = relativePath ? `${relativePath}/${entry}` : entry;
            let stat;
            try {
                stat = require("fs").statSync(fullPath);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                scanDirectory(fullPath, relPath);
            }
            else if (sourceExtensions.some(ext => entry.endsWith(ext))) {
                if (!trackedPaths.has(relPath) && !trackedPaths.has(fullPath)) {
                    result.untracked_files = result.untracked_files || [];
                    // Infer what this file might implement based on name/path
                    const inferredEntity = inferEntityFromFile(relPath, graph);
                    const suggestion = inferredEntity
                        ? `File likely implements "${inferredEntity}" — use sdd.add_node to create FileNode, then sdd.add_relationship to link it`
                        : "Arquivo não rastreado pelo SDD. Considere adicionar um FileNode.";
                    result.untracked_files.push({
                        file_path: relPath,
                        full_path: fullPath,
                        severity: "info",
                        suggestion,
                    });
                    if (!result.has_drift) {
                        result.has_drift = true;
                    }
                }
            }
        }
    }
    scanDirectory(projectDir);
}
/**
 * Try to infer which entity/feature a file implements based on its name.
 */
function inferEntityFromFile(filePath, graph) {
    const fileName = filePath.split("/").pop()?.toLowerCase().replace(/\.[^.]+$/, "") || "";
    if (fileName.length < 3)
        return null;
    // Check against entity names
    const entities = graph.nodes.filter(n => n.type === "entity");
    for (const entity of entities) {
        const entityName = entity.name.toLowerCase();
        if (fileName.includes(entityName) || entityName.includes(fileName)) {
            return entity.name;
        }
    }
    // Check against feature names
    const features = graph.nodes.filter(n => n.type === "feature");
    for (const feature of features) {
        const featureName = feature.name.toLowerCase();
        if (fileName.includes(featureName) || featureName.includes(fileName)) {
            return feature.name;
        }
    }
    return null;
}
function detectSpecCodeMismatches(graph, _projectDir, result, removedNodeIds, deprecatedNodeIds) {
    // Check entity nodes for corresponding persistence (multiple strategies)
    // Uses the same logic as hasPersistenceMapping in validation/validator.ts
    const entities = graph.nodes.filter((n) => n.type === "entity");
    for (const entity of entities) {
        // Skip entities removed by change or deprecated
        if (isNodeExcludedOrDeprecated(entity.id, entity.status, removedNodeIds, deprecatedNodeIds))
            continue;
        if (!hasPersistenceMapping(entity, graph) && entities.length > 0) {
            result.spec_code_mismatches.push({
                node_id: entity.id,
                description: `Entity ${entity.id} has no persistence mapping`,
                severity: "medium",
            });
        }
    }
    // Check API nodes for endpoint completeness
    const apis = graph.nodes.filter((n) => n.type === "api");
    for (const api of apis) {
        // Skip APIs removed by change or deprecated
        if (isNodeExcludedOrDeprecated(api.id, api.status, removedNodeIds, deprecatedNodeIds))
            continue;
        const endpoints = graph.relationships
            .filter((r) => r.from === api.id && r.type === "contains")
            .map((r) => getNode(graph, r.to))
            .filter((n) => n?.type === "endpoint");
        if (endpoints.length === 0) {
            result.spec_code_mismatches.push({
                node_id: api.id,
                description: `API ${api.id} has no endpoints defined`,
                severity: "low",
            });
        }
    }
}
/**
 * Try to find a file in a nearby location when the expected path doesn't exist.
 * Handles common structural changes like:
 * - src/validators.ts → src/fields/validators/index.ts
 * - src/schema.ts → src/schema/index.ts
 * - src/components/X.ts → src/components/X/index.ts
 */
function findFuzzyPathMatch(expectedPath, projectDir) {
    const segments = expectedPath.split("/");
    const filename = segments[segments.length - 1];
    const nameWithoutExt = filename.replace(/\.[^.]+$/, "");
    // Strategy 1: Check if file exists as index in a subdirectory
    // e.g., "src/validators.ts" → try "src/validators/index.ts"
    const withoutExt = expectedPath.replace(/\.[^.]+$/, "");
    const indexCandidates = [
        `${withoutExt}/index.ts`,
        `${withoutExt}/index.tsx`,
        `${withoutExt}/index.js`,
        `${withoutExt}/index.jsx`,
    ];
    for (const candidate of indexCandidates) {
        if (existsSync(projectPath(projectDir, candidate)))
            return candidate;
    }
    // Strategy 2: Search for files with the same name in parent/sibling directories
    segments.slice(0, -1).join("/");
    const parentDir = segments.slice(0, -2).join("/");
    if (parentDir) {
        try {
            const entries = require("fs").readdirSync(projectPath(projectDir, parentDir), { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                const candidateDir = `${parentDir}/${entry.name}`;
                const candidatePath = `${candidateDir}/${filename}`;
                if (existsSync(projectPath(projectDir, candidatePath)))
                    return candidatePath;
                // Also check index files in subdirectories
                const idxCandidates = [
                    `${candidateDir}/${nameWithoutExt}/index.ts`,
                    `${candidateDir}/${nameWithoutExt}/index.tsx`,
                ];
                for (const idx of idxCandidates) {
                    if (existsSync(projectPath(projectDir, idx)))
                        return idx;
                }
            }
        }
        catch {
            // skip
        }
    }
    // Strategy 3: Check one level up in directory tree
    if (segments.length > 2) {
        const parentPath = segments.slice(0, -2).concat(filename).join("/");
        if (existsSync(projectPath(projectDir, parentPath)))
            return parentPath;
    }
    return null;
}
export function formatDriftReport(result) {
    const lines = [];
    if (!result.has_drift) {
        lines.push("✅ No drift detected. SDD and code are in sync.\n");
        return lines.join("\n");
    }
    lines.push("⚠️ Drift Detected\n");
    if (result.missing_files.length > 0) {
        lines.push(`### Missing Files (${result.missing_files.length})`);
        for (const missing of result.missing_files) {
            lines.push(`- [${missing.node_id}] ${missing.file_path} (expected by: ${missing.expected_by})`);
        }
        lines.push("");
    }
    if (result.spec_code_mismatches.length > 0) {
        lines.push(`### Specification Mismatches (${result.spec_code_mismatches.length})`);
        for (const mismatch of result.spec_code_mismatches) {
            lines.push(`- [${mismatch.node_id}] ${mismatch.description} (severity: ${mismatch.severity})`);
        }
        lines.push("");
    }
    if (result.signals && result.signals.total_signals > 0) {
        lines.push(formatDriftSignals(result.signals));
    }
    return lines.join("\n");
}
