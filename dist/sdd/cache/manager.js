import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync, openSync, fsyncSync, closeSync } from "fs";
import { sddDebug, sddError } from "../log.js";
import { join, dirname } from "path";
import { createHash } from "crypto";
import { PerTypeGraphCache } from "../graph/index.js";
import { getGraphSnapshotStore } from "./snapshot-store.js";
import { atomicWriteFile } from "./atomic.js";
import { configFingerprint, graphFingerprint, sourceFingerprint } from "./fingerprint.js";
// ── Main Cache Manager ───────────────────────────────────────────────
const TOOL_RESPONSE_TTL = 5 * 60 * 1000; // 5 minutes
const ANALYSIS_TTL = 3 * 60 * 1000; // 3 minutes
const PERSISTENT_CACHE_FILE = ".sdd/cache.json";
const INVALIDATION_FILE = ".sdd/cache-invalidated.json";
const INVALIDATION_JOURNAL_FILE = ".sdd/cache-events.jsonl";
const TOOL_CATALOG_VERSION = "2026-09-06";
const INVALIDATION_JOURNAL_MAX_BYTES = 1024 * 1024;
export class CacheManager {
    projectDir;
    // In-memory caches
    toolResponses = new Map();
    analysisResults = new Map();
    // Granular invalidation tracker
    invalidation = {
        lastFullInvalidation: 0,
        dirtyTypes: new Set(),
        dirtyNodeIds: new Set(),
        dirtyRelTypes: new Set(),
        version: 0,
    };
    // Version counter for lazy revalidation (F)
    invalidationVersionOnWrite = 0;
    // Per-type graph cache
    graphCache = new PerTypeGraphCache();
    sourceFingerprintCache = null;
    invalidationJournalOffset = 0;
    invalidationEventCounter = 0;
    // Statistics
    stats = {
        toolHits: 0,
        toolMisses: 0,
        analysisHits: 0,
        analysisMisses: 0,
        invalidations: 0,
    };
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.loadInvalidationTracker();
        this.invalidationVersionOnWrite = this.invalidation.version;
        try {
            this.invalidationJournalOffset = statSync(join(projectDir, INVALIDATION_JOURNAL_FILE)).size;
        }
        catch { /* journal not yet created */ }
    }
    // ── Tool Response Cache ───────────────────────────────────────────
    /**
     * Get cached tool response if valid.
     * Checks: TTL (using lastAccess for freshness), graph version, invalidation status.
     * F: Uses lazy revalidation — checks version before clearing.
     */
    getToolResponse(toolName, args, currentGraphFingerprint) {
        this.refreshExternalInvalidation();
        const key = this.toolCacheKey(toolName, args);
        const entry = this.toolResponses.get(key);
        if (!entry) {
            this.stats.toolMisses++;
            return null;
        }
        // F: Lazy revalidation — if invalidation version changed, check if this entry is affected
        if (this.invalidation.version !== this.invalidationVersionOnWrite) {
            if (this.isToolAffectedByInvalidation(toolName, entry.argsHash)) {
                this.toolResponses.delete(key);
                this.clearDirtyTypesForTool(toolName);
                this.stats.toolMisses++;
                return null;
            }
            this.invalidationVersionOnWrite = this.invalidation.version;
        }
        // B: Check TTL using lastAccess (not timestamp) — entries accessed recently survive restore
        const effectiveAge = Date.now() - (entry.lastAccess || entry.timestamp);
        if (effectiveAge > TOOL_RESPONSE_TTL) {
            this.toolResponses.delete(key);
            this.stats.toolMisses++;
            return null;
        }
        // Check graph version consistency
        const currentConfigFingerprint = configFingerprint(this.projectDir);
        if (entry.graphFingerprint !== currentGraphFingerprint || entry.configFingerprint !== currentConfigFingerprint) {
            this.toolResponses.delete(key);
            this.stats.toolMisses++;
            return null;
        }
        if (this.toolNeedsSource(toolName) && entry.sourceFingerprint !== this.getSourceFingerprint()) {
            this.toolResponses.delete(key);
            this.stats.toolMisses++;
            return null;
        }
        // Update access stats — refresh lastAccess on hit
        entry.lastAccess = Date.now();
        this.stats.toolHits++;
        return entry.response;
    }
    /**
     * Cache a tool response.
     */
    setToolResponse(toolName, args, response, currentGraphFingerprint) {
        const key = this.toolCacheKey(toolName, args);
        const now = Date.now();
        this.toolResponses.set(key, {
            response,
            timestamp: now,
            lastAccess: now,
            toolName,
            argsHash: this.toolCacheKey(toolName, args).split(':').at(-1) || '',
            graphFingerprint: currentGraphFingerprint,
            configFingerprint: configFingerprint(this.projectDir),
            sourceFingerprint: this.toolNeedsSource(toolName) ? this.getSourceFingerprint() : undefined,
        });
        // Evict old entries if cache is too large
        if (this.toolResponses.size > 200) {
            this.evictOldestToolEntries(50);
        }
    }
    // ── Analysis Result Cache ─────────────────────────────────────────
    /**
     * Get cached analysis result (validate, drift, quality, etc.).
     * Revalidates based on graph state.
     * F: Uses lazy revalidation.
     */
    getAnalysisResult(type, currentGraphFingerprint) {
        this.refreshExternalInvalidation();
        const key = `analysis:${type}`;
        const entry = this.analysisResults.get(key);
        if (!entry) {
            this.stats.analysisMisses++;
            return null;
        }
        // F: Lazy revalidation
        if (this.invalidation.version !== this.invalidationVersionOnWrite) {
            if (this.isAnalysisAffectedByInvalidation(type)) {
                this.analysisResults.delete(key);
                this.clearDirtyTypesForAnalysis(type);
                this.stats.analysisMisses++;
                return null;
            }
            this.invalidationVersionOnWrite = this.invalidation.version;
        }
        // B: Check TTL using lastAccess
        const effectiveAge = Date.now() - (entry.lastAccess || entry.timestamp);
        if (effectiveAge > ANALYSIS_TTL) {
            this.analysisResults.delete(key);
            this.stats.analysisMisses++;
            return null;
        }
        // Revalidation: graph and configuration content must match exactly.
        if (entry.graphFingerprint !== currentGraphFingerprint || entry.configFingerprint !== configFingerprint(this.projectDir)) {
            this.analysisResults.delete(key);
            this.stats.analysisMisses++;
            return null;
        }
        if (this.analysisNeedsSource(type) && entry.sourceFingerprint !== this.getSourceFingerprint()) {
            this.analysisResults.delete(key);
            this.stats.analysisMisses++;
            return null;
        }
        // Update lastAccess
        entry.lastAccess = Date.now();
        this.stats.analysisHits++;
        return entry.result;
    }
    /**
     * Cache an analysis result.
     */
    setAnalysisResult(type, result, currentGraphFingerprint) {
        const key = `analysis:${type}`;
        const now = Date.now();
        this.analysisResults.set(key, {
            result,
            timestamp: now,
            lastAccess: now,
            graphFingerprint: currentGraphFingerprint,
            configFingerprint: configFingerprint(this.projectDir),
            sourceFingerprint: this.analysisNeedsSource(type) ? this.getSourceFingerprint() : undefined,
            type,
        });
    }
    // ── Granular Invalidation ─────────────────────────────────────────
    /**
     * Mark specific node IDs as dirty.
     */
    invalidateNodeIds(ids) {
        for (const id of ids) {
            this.invalidation.dirtyNodeIds.add(id);
        }
        this.invalidation.version++;
        this.saveInvalidationTracker();
        this.appendInvalidationEvent({ nodeTypes: [], relTypes: [], full: false });
    }
    /**
     * Mark specific relationship types as dirty.
     */
    invalidateRelTypes(types) {
        for (const type of types) {
            this.invalidation.dirtyRelTypes.add(type);
        }
        this.invalidation.version++;
        this.saveInvalidationTracker();
        this.appendInvalidationEvent({ nodeTypes: [], relTypes: types, full: false });
    }
    /**
     * Full invalidation: clear everything.
     * Now reserved only for explicit reset (H) or major structural changes.
     */
    invalidateAll() {
        this.toolResponses.clear();
        this.analysisResults.clear();
        this.graphCache.invalidateAll();
        this.invalidation.lastFullInvalidation = Date.now();
        this.invalidation.dirtyTypes.clear();
        this.invalidation.dirtyNodeIds.clear();
        this.invalidation.dirtyRelTypes.clear();
        this.invalidation.version++;
        this.stats.invalidations++;
        this.saveInvalidationTracker();
        this.appendInvalidationEvent({ nodeTypes: [], relTypes: [], full: true });
    }
    /**
     * Partial invalidation: clear only affected caches.
     * A: Much faster than full invalidation for targeted changes.
     * Called by repositories after saveGraph() with the dirty types.
     */
    invalidatePartial(changedNodeTypes, changedRelTypes = []) {
        // Invalidate tool responses that depend on changed types
        for (const [key] of this.toolResponses) {
            if (this.doesToolDependOnTypes(key, changedNodeTypes, changedRelTypes)) {
                this.toolResponses.delete(key);
            }
        }
        // Invalidate analysis results that depend on changed types
        for (const [key] of this.analysisResults) {
            if (this.doesAnalysisDependOnTypes(key, changedNodeTypes, changedRelTypes)) {
                this.analysisResults.delete(key);
            }
        }
        // Track dirty types
        this.invalidateNodeTypes(changedNodeTypes);
        this.invalidateRelTypes(changedRelTypes);
    }
    /**
     * Invalidate specific node IDs (e.g., when a node is updated).
     */
    invalidateNodeId(nodeId, nodeType) {
        // Invalidate tool responses that mention this node
        for (const [key, entry] of this.toolResponses) {
            if (entry.response.includes(nodeId)) {
                this.toolResponses.delete(key);
            }
        }
        // Invalidate analysis results for this node type
        const analysisTypes = this.getAnalysisTypesForNodeType(nodeType);
        for (const type of analysisTypes) {
            this.analysisResults.delete(`analysis:${type}`);
        }
        this.invalidation.dirtyNodeIds.add(nodeId);
        this.invalidation.dirtyTypes.add(nodeType);
        this.invalidation.version++;
        this.saveInvalidationTracker();
        this.appendInvalidationEvent({ nodeTypes: [nodeType], relTypes: [], full: false });
    }
    // ── Persistent Cache (Cross-Session) ──────────────────────────────
    /**
     * Load persistent cache from disk.
     */
    loadPersistentCache() {
        const path = join(this.projectDir, PERSISTENT_CACHE_FILE);
        if (!existsSync(path))
            return null;
        try {
            const data = JSON.parse(readFileSync(path, "utf-8"));
            // Check if persistent cache is too old (>1 hour)
            if (Date.now() - (data.timestamp || 0) > 60 * 60 * 1000) {
                return null;
            }
            if (data.version !== 2 || !data.toolResponses || !data.analysisResults ||
                typeof data.toolResponses !== "object" || typeof data.analysisResults !== "object") {
                return null;
            }
            return data;
        }
        catch {
            return null;
        }
    }
    /**
     * Save persistent cache to disk.
     */
    savePersistentCache(data) {
        const path = join(this.projectDir, PERSISTENT_CACHE_FILE);
        const dir = dirname(path);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        atomicWriteFile(path, JSON.stringify({ ...data, timestamp: Date.now() }, null, 2));
    }
    /**
     * Restore tool responses from persistent cache.
     * B: Uses lastAccess for TTL check so recently-accessed entries survive restore.
     */
    restoreFromPersistentCache() {
        const persistent = this.loadPersistentCache();
        if (!persistent)
            return 0;
        let restored = 0;
        for (const [key, entry] of Object.entries(persistent.toolResponses)) {
            // B: Use lastAccess for freshness check — entries accessed recently are valid
            const effectiveAge = Date.now() - (entry.lastAccess || entry.timestamp);
            if (effectiveAge < TOOL_RESPONSE_TTL) {
                this.toolResponses.set(key, {
                    response: entry.response,
                    timestamp: entry.timestamp,
                    lastAccess: entry.lastAccess || entry.timestamp,
                    toolName: entry.toolName,
                    argsHash: entry.argsHash,
                    graphFingerprint: entry.graphFingerprint,
                    configFingerprint: entry.configFingerprint || "",
                    sourceFingerprint: entry.sourceFingerprint,
                });
                restored++;
            }
        }
        for (const [key, entry] of Object.entries(persistent.analysisResults)) {
            const effectiveAge = Date.now() - (entry.lastAccess || entry.timestamp);
            if (effectiveAge < ANALYSIS_TTL) {
                this.analysisResults.set(key, {
                    result: entry.result,
                    timestamp: entry.timestamp,
                    lastAccess: entry.lastAccess || entry.timestamp,
                    graphFingerprint: entry.graphFingerprint,
                    configFingerprint: entry.configFingerprint || "",
                    sourceFingerprint: entry.sourceFingerprint,
                    type: key.replace("analysis:", ""),
                });
                restored++;
            }
        }
        return restored;
    }
    /**
     * Persist current cache to disk.
     */
    persistToDisk() {
        const toolResponses = {};
        for (const [key, entry] of this.toolResponses) {
            toolResponses[key] = {
                response: entry.response,
                timestamp: entry.timestamp,
                lastAccess: entry.lastAccess,
                toolName: entry.toolName,
                argsHash: entry.argsHash,
                graphFingerprint: entry.graphFingerprint,
                configFingerprint: entry.configFingerprint,
                sourceFingerprint: entry.sourceFingerprint,
            };
        }
        const analysisResults = {};
        for (const [key, entry] of this.analysisResults) {
            analysisResults[key] = {
                result: entry.result,
                timestamp: entry.timestamp,
                lastAccess: entry.lastAccess,
                graphFingerprint: entry.graphFingerprint,
                configFingerprint: entry.configFingerprint,
                sourceFingerprint: entry.sourceFingerprint,
                type: key.replace("analysis:", ""),
            };
        }
        this.savePersistentCache({
            version: 2,
            toolResponses,
            analysisResults,
            configFingerprint: configFingerprint(this.projectDir),
        });
    }
    /**
     * Save graph snapshot to disk (G).
     * Called after graph mutations and on dispose.
     */
    saveGraphSnapshot(graph, sourceSignature = "") {
        try {
            const store = getGraphSnapshotStore(this.projectDir);
            store.save(graph, graphFingerprint(graph), sourceSignature);
        }
        catch (error) {
            sddError("cache", "Failed to save graph snapshot", error);
        }
    }
    /**
     * Load graph snapshot from disk (G).
     * Returns null if no valid snapshot exists.
     */
    loadGraphSnapshot() {
        try {
            const store = getGraphSnapshotStore(this.projectDir);
            return store.load();
        }
        catch {
            return null;
        }
    }
    /**
     * Invalidate graph snapshot on disk.
     */
    invalidateGraphSnapshot() {
        try {
            const store = getGraphSnapshotStore(this.projectDir);
            store.invalidate();
        }
        catch (error) {
            sddError("cache", "Failed to invalidate graph snapshot", error);
        }
    }
    // ── Cross-Process Shared Cache ────────────────────────────────────
    /**
     * D: Check if another process has modified the graph since our last read.
     * Uses file-based locking + PID liveness check for robust cross-process coordination.
     */
    checkCrossProcessInvalidation(_graphPath) {
        if (this.refreshExternalInvalidation())
            return true;
        const lockPath = join(this.projectDir, ".sdd", ".cache-lock");
        try {
            if (existsSync(lockPath)) {
                const lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
                // D: If lock is older than 30 seconds, check if the process is still alive
                if (Date.now() - lockData.timestamp > 30000) {
                    // D: If the locking process is dead, treat as invalidation needed
                    if (lockData.pid && lockData.pid !== process.pid) {
                        try {
                            process.kill(lockData.pid, 0); // Signal 0 = check if alive
                            // Process is alive but lock is stale — another process is slow, ignore
                            return false;
                        }
                        catch {
                            // Process is dead — force invalidation
                            this.invalidation.lastFullInvalidation = Date.now();
                            this.invalidation.version++;
                            return true;
                        }
                    }
                    return false; // Stale lock from same process or no PID
                }
                // If another process wrote after our last read
                if (lockData.timestamp > (this.invalidation.lastFullInvalidation || 0)) {
                    return true;
                }
            }
        }
        catch (error) {
            sddDebug("cache", "Cross-process lock read failed", error);
        }
        return false;
    }
    /**
     * Acquire cross-process lock before writing.
     */
    acquireWriteLock() {
        const lockPath = join(this.projectDir, ".sdd", ".cache-lock");
        const dir = dirname(lockPath);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        try {
            if (existsSync(lockPath)) {
                const existing = JSON.parse(readFileSync(lockPath, "utf-8"));
                if (existing.pid === process.pid)
                    return true;
                if (Date.now() - existing.timestamp <= 30000)
                    return false;
                try {
                    if (existing.pid)
                        process.kill(existing.pid, 0);
                    return false;
                }
                catch {
                    try {
                        unlinkSync(lockPath);
                    }
                    catch {
                        return false;
                    }
                }
            }
            // wx/O_EXCL makes acquisition atomic when two OpenCode processes write together.
            const descriptor = openSync(lockPath, "wx", 0o600);
            try {
                writeFileSync(descriptor, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), "utf-8");
                fsyncSync(descriptor);
            }
            finally {
                closeSync(descriptor);
            }
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Release cross-process lock.
     */
    releaseWriteLock() {
        const lockPath = join(this.projectDir, ".sdd", ".cache-lock");
        try {
            if (existsSync(lockPath)) {
                const lockData = JSON.parse(readFileSync(lockPath, "utf-8"));
                if (lockData.pid === process.pid) {
                    unlinkSync(lockPath);
                }
            }
        }
        catch (error) {
            sddDebug("cache", "Failed to release write lock", error);
        }
    }
    // ── Full Reset (H) ───────────────────────────────────────────────
    /**
     * H: Full cache reset — clears everything in memory and on disk.
     * Used by /sdd cache reset command.
     */
    fullReset() {
        // Clear in-memory
        this.toolResponses.clear();
        this.analysisResults.clear();
        this.graphCache.invalidateAll();
        // Reset invalidation tracker
        this.invalidation.lastFullInvalidation = Date.now();
        this.invalidation.dirtyTypes.clear();
        this.invalidation.dirtyNodeIds.clear();
        this.invalidation.dirtyRelTypes.clear();
        this.invalidation.version++;
        this.stats.invalidations++;
        this.saveInvalidationTracker();
        this.appendInvalidationEvent({ nodeTypes: [], relTypes: [], full: true });
        // Clear persistent cache on disk
        let disk = false;
        try {
            const cachePath = join(this.projectDir, PERSISTENT_CACHE_FILE);
            if (existsSync(cachePath)) {
                unlinkSync(cachePath);
                disk = true;
            }
        }
        catch (error) {
            sddDebug("cache", "Failed to remove persistent cache", error);
        }
        // Clear graph snapshot (G)
        let snapshot = false;
        try {
            const store = getGraphSnapshotStore(this.projectDir);
            if (store.isValid()) {
                store.invalidate();
                snapshot = true;
            }
        }
        catch (error) {
            sddDebug("cache", "Failed to invalidate snapshot during reset", error);
        }
        // Release lock
        let lock = false;
        try {
            const lockPath = join(this.projectDir, ".sdd", ".cache-lock");
            if (existsSync(lockPath)) {
                this.releaseWriteLock();
                lock = true;
            }
        }
        catch (error) {
            sddDebug("cache", "Failed to release lock during reset", error);
        }
        return { cleared: { memory: true, disk, snapshot, lock } };
    }
    /**
     * Get current invalidation version (for external checks).
     */
    getInvalidationVersion() {
        return this.invalidation.version;
    }
    /**
     * Sync invalidation version after external write.
     */
    syncInvalidationVersion() {
        this.invalidationVersionOnWrite = this.invalidation.version;
    }
    /** Refresh cache state from durable invalidation events written by another process. */
    refreshExternalInvalidation() {
        const journalPath = join(this.projectDir, INVALIDATION_JOURNAL_FILE);
        if (!existsSync(journalPath))
            return false;
        try {
            const size = statSync(journalPath).size;
            if (size < this.invalidationJournalOffset)
                this.invalidationJournalOffset = 0;
            if (size === this.invalidationJournalOffset)
                return false;
            const content = readFileSync(journalPath);
            const start = Math.min(this.invalidationJournalOffset, content.byteLength);
            const recent = content.subarray(start).toString("utf-8");
            const lastCompleteLine = recent.lastIndexOf("\n");
            if (lastCompleteLine < 0)
                return false;
            this.invalidationJournalOffset = start + Buffer.byteLength(recent.slice(0, lastCompleteLine + 1));
            let invalidated = false;
            for (const line of recent.slice(0, lastCompleteLine).split("\n")) {
                if (!line.trim())
                    continue;
                let event;
                try {
                    event = JSON.parse(line);
                }
                catch {
                    invalidated = true;
                    continue;
                }
                if (event.pid === process.pid)
                    continue;
                invalidated = true;
            }
            if (!invalidated)
                return false;
            this.toolResponses.clear();
            this.analysisResults.clear();
            this.graphCache.invalidateAll();
            this.invalidation.version++;
            this.invalidationVersionOnWrite = this.invalidation.version;
            return true;
        }
        catch {
            // A corrupt journal must never make the plugin unusable; force safe misses.
            this.toolResponses.clear();
            this.analysisResults.clear();
            this.graphCache.invalidateAll();
            return true;
        }
    }
    // ── Per-Type Graph Cache ──────────────────────────────────────────
    /**
     * Get cached nodes for a specific type.
     * Only returns if the cache version matches.
     */
    getCachedNodesByType(type, graphFingerprint) {
        return this.graphCache.getNodesByType(type, graphFingerprint);
    }
    /**
     * Cache nodes for a specific type.
     */
    setCachedNodesByType(type, nodes, graphFingerprint) {
        this.graphCache.setType(type, nodes, graphFingerprint);
    }
    /**
     * Invalidate cache for a specific node type only.
     * Other types remain cached.
     */
    invalidateNodeType(type) {
        this.graphCache.invalidateType(type);
        this.invalidateNodeTypes([type]);
    }
    /**
     * Invalidate cache for multiple node types.
     */
    invalidateNodeTypes(types) {
        for (const type of types) {
            this.invalidation.dirtyTypes.add(type);
            this.graphCache.invalidateType(type);
        }
        this.invalidation.version++;
        this.saveInvalidationTracker();
        this.appendInvalidationEvent({ nodeTypes: types, relTypes: [], full: false });
    }
    /**
     * Get cached relationships.
     */
    getCachedRelationships(graphFingerprint) {
        return this.graphCache.getRelationships(graphFingerprint);
    }
    /**
     * Cache relationships.
     */
    setCachedRelationships(rels, graphFingerprint) {
        this.graphCache.setRelationships(rels, graphFingerprint);
    }
    // ── Statistics ────────────────────────────────────────────────────
    getStats() {
        return {
            ...this.stats,
            toolCacheSize: this.toolResponses.size,
            analysisCacheSize: this.analysisResults.size,
            invalidationVersion: this.invalidation.version,
            hitRate: this.stats.toolHits + this.stats.toolMisses > 0
                ? (this.stats.toolHits / (this.stats.toolHits + this.stats.toolMisses) * 100).toFixed(1) + "%"
                : "0%",
            analysisHitRate: this.stats.analysisHits + this.stats.analysisMisses > 0
                ? (this.stats.analysisHits / (this.stats.analysisHits + this.stats.analysisMisses) * 100).toFixed(1) + "%"
                : "0%",
        };
    }
    // ── Private Helpers ───────────────────────────────────────────────
    toolCacheKey(toolName, args) {
        const argsStr = JSON.stringify(args, Object.keys(args).sort());
        const argsHash = createHash("md5").update(argsStr).digest("hex").slice(0, 8);
        return `${TOOL_CATALOG_VERSION}:${toolName}:${argsHash}`;
    }
    isToolAffectedByInvalidation(toolName, _argsHash) {
        // Check if the tool's dependent types have been invalidated
        const dependentTypes = this.getToolDependentTypes(toolName);
        for (const type of dependentTypes) {
            if (this.invalidation.dirtyTypes.has(type))
                return true;
        }
        return false;
    }
    isAnalysisAffectedByInvalidation(analysisType) {
        const dependentTypes = this.getAnalysisDependentTypes(analysisType);
        for (const type of dependentTypes) {
            if (this.invalidation.dirtyTypes.has(type))
                return true;
        }
        return false;
    }
    /**
     * Clear dirty types that are relevant to a specific analysis type.
     * Called after the analysis cache entry has been invalidated due to dirty types.
     * This allows the cache to work again after the analysis is recomputed.
     */
    clearDirtyTypesForAnalysis(analysisType) {
        const dependentTypes = this.getAnalysisDependentTypes(analysisType);
        for (const type of dependentTypes) {
            this.invalidation.dirtyTypes.delete(type);
        }
        this.invalidation.version++;
    }
    /**
     * Clear dirty types that are relevant to a specific tool.
     */
    clearDirtyTypesForTool(toolName) {
        const dependentTypes = this.getToolDependentTypes(toolName);
        for (const type of dependentTypes) {
            this.invalidation.dirtyTypes.delete(type);
        }
        this.invalidation.version++;
    }
    getToolDependentTypes(toolName) {
        const map = {
            "sdd.query_graph": [], // depends on any type
            "sdd.list_nodes": [], // depends on queried type
            "sdd.get_nodes_by_status": [],
            "sdd.count_nodes": [],
            "sdd.inspect": [],
            "sdd.validate": ["feature", "requirement", "entity", "api", "endpoint", "table", "task", "test", "change", "constitution", "business_rule"],
            "sdd.detect_drift": ["file", "task", "change", "entity", "api"],
            "sdd.quality": ["feature", "requirement", "entity", "api", "endpoint", "task", "test", "change", "constitution", "business_rule"],
            "sdd.anti_patterns": ["feature", "requirement", "entity", "change", "task", "test"],
            "sdd.contradictions": ["requirement", "business_rule", "constraint"],
            "sdd.coverage": ["requirement", "test"],
            "sdd.analyze_impact": [],
            "sdd.get_context": [],
            "sdd.pending_changes": ["change"],
            "sdd.session_handoff": ["change", "decision"],
        };
        return map[toolName] || [];
    }
    getAnalysisDependentTypes(analysisType) {
        const map = {
            "validate": ["feature", "requirement", "entity", "api", "endpoint", "table", "task", "test", "change", "constitution", "business_rule"],
            "drift": ["file", "task", "change", "entity", "api"],
            "quality": ["feature", "requirement", "entity", "api", "endpoint", "task", "test", "change", "constitution", "business_rule"],
            "anti_patterns": ["feature", "requirement", "entity", "change", "task", "test"],
            "contradictions": ["requirement", "business_rule", "constraint"],
            "coverage": ["requirement", "test"],
            "constitution": ["constitution", "feature", "requirement", "entity", "business_rule"],
            "promises": ["requirement", "business_rule"],
            "integrity": [],
        };
        return map[analysisType] || [];
    }
    getAnalysisTypesForNodeType(nodeType) {
        const map = {
            "feature": ["validate", "quality", "anti_patterns"],
            "requirement": ["validate", "quality", "coverage", "promises", "constitution"],
            "entity": ["validate", "quality", "drift"],
            "endpoint": ["validate", "quality"],
            "api": ["validate", "quality"],
            "business_rule": ["validate", "quality", "contradictions", "promises"],
            "change": ["validate", "quality", "anti_patterns"],
            "task": ["validate", "quality", "drift"],
            "test": ["validate", "quality", "coverage"],
            "file": ["drift"],
            "constitution": ["validate", "constitution"],
            "constraint": ["contradictions"],
        };
        return map[nodeType] || [];
    }
    doesToolDependOnTypes(key, types, _relTypes) {
        const parts = key.split(":");
        const toolName = parts.length >= 3 ? parts.slice(1, -1).join(":") : parts[0];
        const depTypes = this.getToolDependentTypes(toolName);
        if (depTypes.length === 0)
            return true; // Unknown dependency, invalidate to be safe
        return types.some(t => depTypes.includes(t));
    }
    doesAnalysisDependOnTypes(key, types, _relTypes) {
        const analysisType = key.replace("analysis:", "");
        const depTypes = this.getAnalysisDependentTypes(analysisType);
        if (depTypes.length === 0)
            return true;
        return types.some(t => depTypes.includes(t));
    }
    evictOldestToolEntries(count) {
        const entries = [...this.toolResponses.entries()]
            .sort((a, b) => (a[1].lastAccess || a[1].timestamp) - (b[1].lastAccess || b[1].timestamp));
        for (let i = 0; i < count && i < entries.length; i++) {
            this.toolResponses.delete(entries[i][0]);
        }
    }
    loadInvalidationTracker() {
        const path = join(this.projectDir, INVALIDATION_FILE);
        if (!existsSync(path))
            return;
        try {
            const data = JSON.parse(readFileSync(path, "utf-8"));
            this.invalidation.lastFullInvalidation = data.lastFullInvalidation || 0;
            this.invalidation.version = data.version || 0;
            this.invalidation.dirtyTypes = new Set(data.dirtyTypes || []);
            this.invalidation.dirtyNodeIds = new Set(data.dirtyNodeIds || []);
            this.invalidation.dirtyRelTypes = new Set(data.dirtyRelTypes || []);
        }
        catch (error) {
            sddDebug("cache", "Invalidation tracker load failed, starting fresh", error);
        }
    }
    saveInvalidationTracker() {
        const path = join(this.projectDir, INVALIDATION_FILE);
        const dir = dirname(path);
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        atomicWriteFile(path, JSON.stringify({
            lastFullInvalidation: this.invalidation.lastFullInvalidation,
            version: this.invalidation.version,
            dirtyTypes: [...this.invalidation.dirtyTypes],
            dirtyNodeIds: [...this.invalidation.dirtyNodeIds],
            dirtyRelTypes: [...this.invalidation.dirtyRelTypes],
        }));
    }
    appendInvalidationEvent(change) {
        const path = join(this.projectDir, INVALIDATION_JOURNAL_FILE);
        const event = {
            id: `${Date.now()}-${process.pid}-${++this.invalidationEventCounter}`,
            timestamp: Date.now(),
            pid: process.pid,
            ...change,
        };
        try {
            const directory = dirname(path);
            if (!existsSync(directory))
                mkdirSync(directory, { recursive: true });
            if (existsSync(path) && statSync(path).size > INVALIDATION_JOURNAL_MAX_BYTES) {
                atomicWriteFile(path, `${JSON.stringify(event)}\n`);
            }
            else {
                const descriptor = openSync(path, "a", 0o600);
                try {
                    writeFileSync(descriptor, `${JSON.stringify(event)}\n`, "utf-8");
                    fsyncSync(descriptor);
                }
                finally {
                    closeSync(descriptor);
                }
            }
            this.invalidationJournalOffset = statSync(path).size;
        }
        catch (error) {
            sddDebug("cache", "Invalidation journal append failed", error);
        }
    }
    toolNeedsSource(toolName) {
        return toolName === "sdd.detect_drift" || toolName === "sdd.quality" || toolName === "sdd.coverage";
    }
    analysisNeedsSource(type) {
        return type === "drift" || type === "quality" || type === "coverage";
    }
    getSourceFingerprint() {
        const current = sourceFingerprint(this.projectDir, this.sourceFingerprintCache);
        this.sourceFingerprintCache = current;
        return current.fingerprint;
    }
}
// ── Singleton per project ────────────────────────────────────────────
const instances = new Map();
export function getCacheManager(projectDir) {
    let instance = instances.get(projectDir);
    if (!instance) {
        instance = new CacheManager(projectDir);
        instances.set(projectDir, instance);
    }
    return instance;
}
