import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
const SOURCE_EXTENSIONS = new Set([
    ".c", ".cc", ".cpp", ".cs", ".go", ".h", ".hpp", ".java", ".js", ".jsx",
    ".json", ".kt", ".mjs", ".mts", ".py", ".rb", ".rs", ".svelte", ".swift",
    ".ts", ".tsx", ".vue", ".yaml", ".yml",
]);
const IGNORED_DIRECTORIES = new Set([
    ".git", ".sdd", ".opencode", "node_modules", "dist", "build", "coverage",
    ".cache", ".next", ".turbo", "target", "vendor",
]);
export function stableSerialize(value) {
    if (value === null)
        return "null";
    if (value === undefined)
        return "undefined";
    if (typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableSerialize).join(",")}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
/** Deterministic content fingerprint for the complete graph, independent of YAML/SQLite formatting. */
export function graphFingerprint(graph) {
    return sha256(stableSerialize({
        version: graph.version,
        project_id: graph.project_id,
        metadata: graph.metadata,
        nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
        relationships: [...graph.relationships].sort((a, b) => a.id.localeCompare(b.id)),
    }));
}
export function fileContentFingerprint(filePath) {
    try {
        return sha256(readFileSync(filePath));
    }
    catch {
        return sha256(`missing:${filePath}`);
    }
}
/** Cryptographic content identity for external-file detection. */
export function fileSignature(filePaths) {
    const parts = filePaths.map((filePath) => {
        return `${filePath}:${fileContentFingerprint(filePath)}`;
    });
    return sha256(parts.sort().join("\n"));
}
export function configFingerprint(projectDir) {
    const path = join(projectDir, ".sdd", "config.json");
    return existsSync(path) ? fileContentFingerprint(path) : sha256("missing-config");
}
function sourceFiles(projectDir) {
    const files = [];
    const visit = (directory) => {
        let entries;
        try {
            entries = readdirSync(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink())
                continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!IGNORED_DIRECTORIES.has(entry.name))
                    visit(path);
                continue;
            }
            const extension = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
            if (SOURCE_EXTENSIONS.has(extension))
                files.push(path);
        }
    };
    visit(projectDir);
    return files.sort();
}
/**
 * Content fingerprint for code-dependent analyses.
 *
 * File stat metadata is not trusted as proof of unchanged content: editors,
 * overlays and fast successive writes can preserve size and timestamps.
 */
export function sourceFingerprint(projectDir, previous) {
    const files = sourceFiles(projectDir);
    const signature = fileSignature(files);
    if (previous?.signature === signature)
        return previous;
    const content = files.map((path) => `${relative(projectDir, path)}:${fileContentFingerprint(path)}`).join("\n");
    const fingerprint = sha256(content);
    if (previous?.signature === signature && previous.fingerprint === fingerprint)
        return previous;
    return { fingerprint, signature };
}
