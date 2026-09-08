import { existsSync, readFileSync, mkdirSync } from "fs";
import { atomicWriteFile } from "../cache/atomic.js";
import { join, dirname } from "path";
/**
 * Collects all node IDs that were removed by completed or approved changes.
 * Nodes removed via ChangeNode should not be flagged as drift or cause
 * false positives in validation, coverage, contradictions, etc.
 */
export function getRemovedNodeIds(graph) {
    const removed = new Set();
    const changes = graph.nodes.filter((n) => n.type === "change" &&
        ["COMPLETED", "APPROVED", "IMPLEMENTED"].includes(n.status));
    for (const change of changes) {
        const meta = change.metadata;
        if (Array.isArray(meta.removed_nodes)) {
            for (const id of meta.removed_nodes) {
                removed.add(id);
            }
        }
    }
    return removed;
}
/**
 * Collects all node IDs that were deprecated via DeprecationNode relationships.
 */
export function getDeprecatedNodeIds(graph) {
    const deprecated = new Set();
    const deprecationNodes = graph.nodes.filter((n) => n.type === "deprecation");
    for (const dep of deprecationNodes) {
        const targets = graph.relationships
            .filter((r) => r.from === dep.id && r.type === "deprecates")
            .map((r) => r.to);
        for (const id of targets) {
            deprecated.add(id);
        }
    }
    return deprecated;
}
/**
 * Checks if a node should be excluded, also considering DEPRECATED status.
 */
export function isNodeExcludedOrDeprecated(nodeId, status, removedIds, deprecatedIds) {
    return (status === "DEPRECATED" ||
        removedIds.has(nodeId) ||
        deprecatedIds.has(nodeId));
}
/**
 * Convenience: pre-compute both sets at once.
 */
export function getExclusionSets(graph) {
    return {
        removed: getRemovedNodeIds(graph),
        deprecated: getDeprecatedNodeIds(graph),
    };
}
// ── Drift Whitelist ─────────────────────────────────────────────────
const DRIFT_WHITELIST_FILE = ".sdd/drift-whitelist.json";
/**
 * Load the drift whitelist from disk.
 */
export function loadDriftWhitelist(projectDir) {
    const path = join(projectDir, DRIFT_WHITELIST_FILE);
    if (!existsSync(path))
        return { version: 1, entries: [] };
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch {
        return { version: 1, entries: [] };
    }
}
/**
 * Save the drift whitelist to disk.
 */
export function saveDriftWhitelist(projectDir, whitelist) {
    const path = join(projectDir, DRIFT_WHITELIST_FILE);
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    atomicWriteFile(path, JSON.stringify(whitelist, null, 2));
}
/**
 * Add a file to the drift whitelist.
 */
export function addToDriftWhitelist(projectDir, filePath, reason, addedBy) {
    const whitelist = loadDriftWhitelist(projectDir);
    const normalizedPath = filePath.replace(/^\.\//, "");
    // Don't add duplicates
    if (!whitelist.entries.some(e => e.file_path === normalizedPath)) {
        whitelist.entries.push({
            file_path: normalizedPath,
            reason,
            added_at: new Date().toISOString(),
            added_by: addedBy,
        });
        saveDriftWhitelist(projectDir, whitelist);
    }
    return whitelist;
}
/**
 * Remove a file from the drift whitelist.
 */
export function removeFromDriftWhitelist(projectDir, filePath) {
    const whitelist = loadDriftWhitelist(projectDir);
    const normalizedPath = filePath.replace(/^\.\//, "");
    whitelist.entries = whitelist.entries.filter(e => e.file_path !== normalizedPath);
    saveDriftWhitelist(projectDir, whitelist);
    return whitelist;
}
/**
 * Check if a file path matches any whitelist pattern (supports wildcards).
 * E.g., "src/validators/*" matches all files in src/validators/
 */
export function isFileWhitelistedPattern(projectDir, filePath) {
    const whitelist = loadDriftWhitelist(projectDir);
    const normalizedPath = filePath.replace(/^\.\//, "");
    for (const entry of whitelist.entries) {
        // Exact match
        if (entry.file_path === normalizedPath)
            return true;
        // Recursive wildcard: apps/**, packages/**, **/*.ts, etc.
        if (entry.file_path.endsWith("/**")) {
            const prefix = entry.file_path.slice(0, -3);
            if (normalizedPath.startsWith(prefix + "/") || normalizedPath === prefix)
                return true;
        }
        // Single-level wildcard: src/validators/*
        if (entry.file_path.endsWith("/*") && !entry.file_path.endsWith("/**")) {
            const prefix = entry.file_path.slice(0, -2);
            if (normalizedPath.startsWith(prefix + "/") || normalizedPath === prefix)
                return true;
        }
        // Directory match (ends with /)
        if (entry.file_path.endsWith("/")) {
            if (normalizedPath.startsWith(entry.file_path))
                return true;
        }
        // Glob wildcard in filename: **/*.ts, *.tsx, src/**/*.ts
        if (entry.file_path.includes("*")) {
            const regex = globToRegex(entry.file_path);
            if (regex.test(normalizedPath))
                return true;
        }
    }
    return false;
}
/**
 * Convert a glob pattern to a RegExp.
 * Supports double-star and single-star patterns.
 */
function globToRegex(glob) {
    // Process segments separated by /
    const segments = glob.split("/");
    const regexParts = [];
    for (const seg of segments) {
        if (seg === "**") {
            // ** matches any number of path segments
            regexParts.push(".*");
        }
        else if (seg === "*") {
            // Single * matches within one segment
            regexParts.push("[^/]+");
        }
        else if (seg.includes("*")) {
            // Mixed segment like *.ts or tsx-*.test
            const escaped = seg.replace(/\./g, "\\.");
            const inner = escaped.replace(/\*/g, "[^/]*");
            regexParts.push(inner);
        }
        else {
            // Literal segment
            const escaped = seg.replace(/\./g, "\\.");
            regexParts.push(escaped);
        }
    }
    // Join with \/ to match path separators
    const pattern = regexParts.join("\\/");
    return new RegExp("^" + pattern + "$");
}
