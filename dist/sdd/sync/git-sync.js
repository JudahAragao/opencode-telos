import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { atomicWriteFile } from "../cache/atomic.js";
import { graphFingerprint } from "../cache/fingerprint.js";
const LOCK_FILE = ".sdd/sync.lock";
const SYNC_STATE_FILE = ".sdd/sync-state.json";
const syncStatusCache = new Map();
export function getSyncStatus(projectDir, options) {
    const ttl = options?.cacheTTL ?? 10000;
    const cacheKey = projectDir;
    // Check cache
    if (options?.statusCache) {
        if (Date.now() - options.statusCache.timestamp < ttl)
            return options.statusCache.status;
    }
    const globalCached = syncStatusCache.get(cacheKey);
    if (globalCached && Date.now() - globalCached.timestamp < ttl)
        return globalCached.status;
    try {
        const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 5000,
        }).trim();
        let ahead = 0;
        let behind = 0;
        if (!options?.skipAheadBehind) {
            try {
                ahead = Number.parseInt(execFileSync("git", ["rev-list", "--count", "@{u}..HEAD"], {
                    cwd: projectDir, encoding: "utf-8", timeout: 5000,
                }).trim(), 10) || 0;
            }
            catch {
                ahead = 0;
            }
            try {
                behind = Number.parseInt(execFileSync("git", ["rev-list", "--count", "HEAD..@{u}"], {
                    cwd: projectDir, encoding: "utf-8", timeout: 5000,
                }).trim(), 10) || 0;
            }
            catch {
                behind = 0;
            }
        }
        const status = execFileSync("git", ["status", "--porcelain"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 5000,
        }).trim();
        const hasRemote = execFileSync("git", ["remote", "-v"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 5000,
        }).trim().length > 0;
        const syncState = loadSyncState(projectDir);
        const result = {
            has_remote: hasRemote,
            branch,
            ahead,
            behind,
            dirty: status.length > 0,
            last_sync: syncState?.last_sync,
        };
        // Store in cache
        if (options?.statusCache) {
            options.statusCache.status = result;
            options.statusCache.timestamp = Date.now();
        }
        syncStatusCache.set(cacheKey, { status: result, timestamp: Date.now() });
        return result;
    }
    catch {
        return {
            has_remote: false,
            branch: "unknown",
            ahead: 0,
            behind: 0,
            dirty: false,
        };
    }
}
export function acquireLock(projectDir, owner) {
    const lockPath = join(projectDir, LOCK_FILE);
    const dir = dirname(lockPath);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    if (existsSync(lockPath)) {
        try {
            const lock = JSON.parse(readFileSync(lockPath, "utf-8"));
            const lockAge = Date.now() - new Date(lock.timestamp).getTime();
            if (lockAge < 300000) {
                return false;
            }
            unlinkSync(lockPath);
        }
        catch {
            // stale lock
            try {
                unlinkSync(lockPath);
            }
            catch { }
        }
    }
    try {
        const descriptor = openSync(lockPath, "wx", 0o600);
        writeFileSync(descriptor, JSON.stringify({ owner, timestamp: new Date().toISOString() }), "utf-8");
        closeSync(descriptor);
        return true;
    }
    catch {
        return false;
    }
}
export function releaseLock(projectDir) {
    const lockPath = join(projectDir, LOCK_FILE);
    if (existsSync(lockPath)) {
        const lock = JSON.parse(readFileSync(lockPath, "utf-8"));
        if (lock.owner === process.env.USER || lock.owner === "current") {
            unlinkSync(lockPath);
        }
    }
}
export function pullLatest(projectDir) {
    try {
        const status = getSyncStatus(projectDir);
        if (!status.has_remote) {
            return { success: false, action: "pull", details: "No remote configured" };
        }
        if (status.behind === 0) {
            return { success: true, action: "pull", details: "Already up to date" };
        }
        execFileSync("git", ["pull", "--no-edit"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 30000,
        });
        saveSyncState(projectDir, { last_sync: new Date().toISOString() });
        return {
            success: true,
            action: "pull",
            details: `Pulled ${status.behind} commit(s) from remote`,
        };
    }
    catch (error) {
        return {
            success: false,
            action: "pull",
            details: `Pull failed: ${error instanceof Error ? error.message : "unknown error"}`,
        };
    }
}
export function pushChanges(projectDir, message) {
    try {
        const status = getSyncStatus(projectDir);
        if (!status.has_remote) {
            return { success: false, action: "push", details: "No remote configured" };
        }
        execFileSync("git", ["add", ".sdd/"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 10000,
        });
        execFileSync("git", ["commit", "-m", message, "--allow-empty"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 10000,
        });
        execFileSync("git", ["push"], {
            cwd: projectDir,
            encoding: "utf-8",
            timeout: 30000,
        });
        saveSyncState(projectDir, { last_sync: new Date().toISOString() });
        return {
            success: true,
            action: "push",
            details: `Pushed changes to remote`,
        };
    }
    catch (error) {
        return {
            success: false,
            action: "push",
            details: `Push failed: ${error instanceof Error ? error.message : "unknown error"}`,
        };
    }
}
export function detectConflicts(localGraph, remoteGraphPath, options) {
    const conflicts = [];
    if (!existsSync(remoteGraphPath))
        return conflicts;
    try {
        const remoteContent = readFileSync(remoteGraphPath, "utf-8");
        const remoteGraph = JSON.parse(remoteContent);
        // Check cache
        const graphHash = `${graphFingerprint(localGraph)}:${graphFingerprint(remoteGraph)}`;
        if (options?.conflictCache && options.conflictCache.graphHash === graphHash) {
            return options.conflictCache.conflicts;
        }
        const localNodeMap = new Map(localGraph.nodes.map((n) => [n.id, n]));
        const remoteNodeMap = new Map(remoteGraph.nodes.map((n) => [n.id, n]));
        // Determine which nodes to compare
        const nodesToCompare = options?.focusChangedNodes
            ? options.focusChangedNodes
            : [...localNodeMap.keys()];
        const maxConflicts = options?.maxConflicts ?? Infinity;
        for (const nodeId of nodesToCompare) {
            if (conflicts.length >= maxConflicts)
                break;
            const localNode = localNodeMap.get(nodeId);
            if (!localNode)
                continue;
            // Skip excluded types
            if (options?.excludeNodeTypes?.includes(localNode.type))
                continue;
            const remoteNode = remoteNodeMap.get(nodeId);
            if (!remoteNode)
                continue;
            if (localNode.updated_at !== remoteNode.updated_at) {
                const localMeta = localNode.metadata;
                const remoteMeta = remoteNode.metadata;
                for (const key of Object.keys(localMeta)) {
                    if (conflicts.length >= maxConflicts)
                        break;
                    if (JSON.stringify(localMeta[key]) !== JSON.stringify(remoteMeta[key])) {
                        conflicts.push({
                            node_id: nodeId,
                            field: key,
                            local_value: localMeta[key],
                            remote_value: remoteMeta[key],
                        });
                    }
                }
            }
        }
        // Store in cache
        if (options?.conflictCache) {
            options.conflictCache.conflicts = conflicts;
            options.conflictCache.timestamp = Date.now();
            options.conflictCache.graphHash = graphHash;
        }
    }
    catch {
        // remote graph parse error
    }
    return conflicts;
}
export function resolveConflict(conflict, resolution) {
    return { ...conflict, resolution };
}
export function mergeGraphs(local, remote, strategy) {
    const merged = { ...local };
    const remoteNodeMap = new Map(remote.nodes.map((n) => [n.id, n]));
    for (let i = 0; i < merged.nodes.length; i++) {
        const localNode = merged.nodes[i];
        const remoteNode = remoteNodeMap.get(localNode.id);
        if (remoteNode && new Date(remoteNode.updated_at) > new Date(localNode.updated_at)) {
            if (strategy.auto_resolve) {
                const priority = strategy.field_priorities[localNode.id] || "remote";
                if (priority === "remote") {
                    merged.nodes[i] = remoteNode;
                }
            }
        }
    }
    for (const remoteNode of remote.nodes) {
        if (!merged.nodes.find((n) => n.id === remoteNode.id)) {
            merged.nodes.push(remoteNode);
        }
    }
    const relationshipIds = new Set(merged.relationships.map((relationship) => relationship.id));
    for (const relationship of remote.relationships) {
        if (!relationshipIds.has(relationship.id))
            merged.relationships.push(relationship);
    }
    merged.metadata.updated_at = new Date().toISOString();
    return merged;
}
function loadSyncState(projectDir) {
    const path = join(projectDir, SYNC_STATE_FILE);
    if (!existsSync(path))
        return null;
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch {
        return null;
    }
}
function saveSyncState(projectDir, state) {
    const path = join(projectDir, SYNC_STATE_FILE);
    const dir = dirname(path);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    atomicWriteFile(path, JSON.stringify(state, null, 2));
}
export function formatSyncStatus(status) {
    const lines = [
        "## Sync Status",
        "",
        `- **Branch:** ${status.branch}`,
        `- **Remote:** ${status.has_remote ? "✅ Configured" : "❌ Not configured"}`,
        `- **Ahead:** ${status.ahead} commit(s)`,
        `- **Behind:** ${status.behind} commit(s)`,
        `- **Dirty:** ${status.dirty ? "⚠️ Yes" : "✅ No"}`,
    ];
    if (status.last_sync) {
        lines.push(`- **Last Sync:** ${status.last_sync}`);
    }
    if (status.behind > 0) {
        lines.push("\n⚠️ **Run `sdd.sync_pull` to get latest changes**");
    }
    if (status.ahead > 0) {
        lines.push("\n📤 **Run `sdd.sync_push` to share your changes**");
    }
    return lines.join("\n");
}
