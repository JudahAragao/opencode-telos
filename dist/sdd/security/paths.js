import { existsSync, realpathSync } from "fs";
import { dirname, relative, resolve } from "path";
function isWithin(root, candidate) {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}
/** Resolve a user-provided path without allowing traversal or symlink escape. */
export function projectPath(projectDir, userPath, forWrite = false) {
    const root = realpathSync(projectDir);
    const candidate = resolve(root, userPath);
    if (!isWithin(root, candidate))
        throw new Error(`Path is outside the project: ${userPath}`);
    if (existsSync(candidate)) {
        const realCandidate = realpathSync(candidate);
        if (!isWithin(root, realCandidate))
            throw new Error(`Symlink escapes the project: ${userPath}`);
        return realCandidate;
    }
    let parentPath = dirname(candidate);
    while (!existsSync(parentPath) && parentPath !== root)
        parentPath = dirname(parentPath);
    const parent = realpathSync(parentPath);
    if (!isWithin(root, parent))
        throw new Error(`Path parent is outside the project: ${userPath}`);
    if (forWrite && !isWithin(root, candidate))
        throw new Error(`Write path is outside the project: ${userPath}`);
    return candidate;
}
export function assertProjectPath(projectDir, userPath) {
    projectPath(projectDir, userPath);
}
