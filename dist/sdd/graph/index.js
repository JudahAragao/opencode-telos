/**
 * Pre-computed indices for O(1) lookups on a KnowledgeGraph.
 * Supports both full rebuild and incremental updates.
 */
export class GraphIndices {
    mutableById;
    mutableByType;
    mutableByStatus;
    mutableOutgoing;
    mutableIncoming;
    mutableAll;
    mutableRelByType;
    mutableNeighbors;
    searchIndex;
    totalNodes;
    totalRelationships;
    constructor(graph) {
        this.mutableById = new Map();
        this.mutableByType = new Map();
        this.mutableByStatus = new Map();
        this.mutableOutgoing = new Map();
        this.mutableIncoming = new Map();
        this.mutableAll = new Map();
        this.mutableRelByType = new Map();
        this.mutableNeighbors = new Map();
        this.searchIndex = new InvertedIndex();
        this.totalNodes = graph.nodes.length;
        this.totalRelationships = graph.relationships.length;
        this.buildNodeIndices(graph);
        this.buildRelationshipIndices(graph);
        this.buildSearchIndex(graph);
    }
    get byId() { return new Map([...this.mutableById].map(([key, value]) => [key, clone(value)])); }
    get byType() { return new Map([...this.mutableByType].map(([key, value]) => [key, value.map(clone)])); }
    get byStatus() { return new Map([...this.mutableByStatus].map(([key, value]) => [key, value.map(clone)])); }
    get outgoing() { return new Map([...this.mutableOutgoing].map(([key, value]) => [key, value.map(clone)])); }
    get incoming() { return new Map([...this.mutableIncoming].map(([key, value]) => [key, value.map(clone)])); }
    get all() { return new Map([...this.mutableAll].map(([key, value]) => [key, value.map(clone)])); }
    get relByType() { return new Map([...this.mutableRelByType].map(([key, value]) => [key, value.map(clone)])); }
    get neighbors() { return new Map([...this.mutableNeighbors].map(([key, value]) => [key, new Set(value)])); }
    static from(graph) {
        return new GraphIndices(graph);
    }
    // ── Node index building ────────────────────────────────────────────
    buildNodeIndices(graph) {
        for (const node of graph.nodes) {
            this.mutableById.set(node.id, node);
            const typeList = this.mutableByType.get(node.type);
            if (typeList)
                typeList.push(node);
            else
                this.mutableByType.set(node.type, [node]);
            const statusList = this.mutableByStatus.get(node.status);
            if (statusList)
                statusList.push(node);
            else
                this.mutableByStatus.set(node.status, [node]);
            this.mutableNeighbors.set(node.id, new Set());
        }
    }
    // ── Relationship index building ────────────────────────────────────
    buildRelationshipIndices(graph) {
        for (const rel of graph.relationships) {
            this.addToRelIndices(rel);
        }
    }
    addToRelIndices(rel) {
        const outgoingList = this.mutableOutgoing.get(rel.from);
        if (outgoingList)
            outgoingList.push(rel);
        else
            this.mutableOutgoing.set(rel.from, [rel]);
        const incomingList = this.mutableIncoming.get(rel.to);
        if (incomingList)
            incomingList.push(rel);
        else
            this.mutableIncoming.set(rel.to, [rel]);
        const allList = this.mutableAll.get(rel.from);
        if (allList)
            allList.push(rel);
        else
            this.mutableAll.set(rel.from, [rel]);
        if (rel.from !== rel.to) {
            const allListTo = this.mutableAll.get(rel.to);
            if (allListTo)
                allListTo.push(rel);
            else
                this.mutableAll.set(rel.to, [rel]);
        }
        const relTypeList = this.mutableRelByType.get(rel.type);
        if (relTypeList)
            relTypeList.push(rel);
        else
            this.mutableRelByType.set(rel.type, [rel]);
        this.mutableNeighbors.get(rel.from)?.add(rel.to);
        this.mutableNeighbors.get(rel.to)?.add(rel.from);
    }
    removeFromRelIndices(rel) {
        const removeById = (map, key, rel) => {
            const list = map.get(key);
            if (list) {
                const idx = list.findIndex(r => r.id === rel.id);
                if (idx !== -1)
                    list.splice(idx, 1);
            }
        };
        removeById(this.mutableOutgoing, rel.from, rel);
        removeById(this.mutableIncoming, rel.to, rel);
        removeById(this.mutableAll, rel.from, rel);
        if (rel.from !== rel.to)
            removeById(this.mutableAll, rel.to, rel);
        const relTypeList = this.mutableRelByType.get(rel.type);
        if (relTypeList) {
            const idx = relTypeList.findIndex(r => r.id === rel.id);
            if (idx !== -1)
                relTypeList.splice(idx, 1);
        }
        this.mutableNeighbors.get(rel.from)?.delete(rel.to);
        this.mutableNeighbors.get(rel.to)?.delete(rel.from);
    }
    // ── Search index building ──────────────────────────────────────────
    buildSearchIndex(graph) {
        for (const node of graph.nodes) {
            this.indexNodeForSearch(node);
        }
    }
    indexNodeForSearch(node) {
        const tokens = new Set();
        tokens.add(node.id.toLowerCase());
        tokens.add(node.type.toLowerCase());
        tokens.add(node.status.toLowerCase());
        tokens.add(node.name.toLowerCase());
        if (node.description) {
            tokenize(node.description, tokens);
        }
        const meta = node.metadata;
        for (const [key, value] of Object.entries(meta)) {
            tokens.add(key.toLowerCase());
            if (typeof value === "string") {
                tokenize(value, tokens);
            }
            else if (typeof value === "number") {
                tokens.add(String(value));
            }
        }
        this.searchIndex.add(node.id, tokens);
    }
    // ── Incremental Updates ────────────────────────────────────────────
    /**
     * Add a single node to all indices without rebuilding.
     * O(1) per index, no full scan.
     */
    addNode(node) {
        this.mutableById.set(node.id, node);
        const typeList = this.mutableByType.get(node.type);
        if (typeList)
            typeList.push(node);
        else
            this.mutableByType.set(node.type, [node]);
        const statusList = this.mutableByStatus.get(node.status);
        if (statusList)
            statusList.push(node);
        else
            this.mutableByStatus.set(node.status, [node]);
        this.mutableNeighbors.set(node.id, new Set());
        this.indexNodeForSearch(node);
    }
    /**
     * Update a single node in all indices without rebuilding.
     * Only updates the specific entries that changed.
     */
    updateNode(oldNode, newNode) {
        // Update byId
        this.mutableById.set(newNode.id, newNode);
        // Update byType if type changed
        if (oldNode.type !== newNode.type) {
            const oldTypeList = this.mutableByType.get(oldNode.type);
            if (oldTypeList) {
                const idx = oldTypeList.findIndex(n => n.id === oldNode.id);
                if (idx !== -1)
                    oldTypeList.splice(idx, 1);
            }
            const newTypeList = this.mutableByType.get(newNode.type);
            if (newTypeList)
                newTypeList.push(newNode);
            else
                this.mutableByType.set(newNode.type, [newNode]);
        }
        // Update byStatus if status changed
        if (oldNode.status !== newNode.status) {
            const oldStatusList = this.mutableByStatus.get(oldNode.status);
            if (oldStatusList) {
                const idx = oldStatusList.findIndex(n => n.id === oldNode.id);
                if (idx !== -1)
                    oldStatusList.splice(idx, 1);
            }
            const newStatusList = this.mutableByStatus.get(newNode.status);
            if (newStatusList)
                newStatusList.push(newNode);
            else
                this.mutableByStatus.set(newNode.status, [newNode]);
        }
        // Update search index
        this.searchIndex.remove(oldNode.id);
        this.indexNodeForSearch(newNode);
    }
    /**
     * Remove a single node from all indices without rebuilding.
     */
    removeNode(nodeId) {
        const node = this.mutableById.get(nodeId);
        if (!node)
            return;
        this.mutableById.delete(nodeId);
        // Remove from byType
        const typeList = this.mutableByType.get(node.type);
        if (typeList) {
            const idx = typeList.findIndex(n => n.id === nodeId);
            if (idx !== -1)
                typeList.splice(idx, 1);
        }
        // Remove from byStatus
        const statusList = this.mutableByStatus.get(node.status);
        if (statusList) {
            const idx = statusList.findIndex(n => n.id === nodeId);
            if (idx !== -1)
                statusList.splice(idx, 1);
        }
        // Remove from neighbors
        this.mutableNeighbors.delete(nodeId);
        for (const [, neighbors] of this.mutableNeighbors) {
            neighbors.delete(nodeId);
        }
        // Remove from search index
        this.searchIndex.remove(nodeId);
    }
    /**
     * Add a relationship to indices without rebuilding.
     */
    addRelationship(rel) {
        this.addToRelIndices(rel);
    }
    /**
     * Remove a relationship from indices without rebuilding.
     */
    removeRelationship(rel) {
        this.removeFromRelIndices(rel);
    }
    // ── Query helpers ──────────────────────────────────────────────────
    getNode(id) {
        const node = this.mutableById.get(id);
        return node ? clone(node) : undefined;
    }
    getNodesByType(type) {
        return (this.mutableByType.get(type) || []).map(clone);
    }
    getNodesByStatus(status) {
        return (this.mutableByStatus.get(status) || []).map(clone);
    }
    getOutgoing(nodeId) {
        return (this.mutableOutgoing.get(nodeId) || []).map(clone);
    }
    getIncoming(nodeId) {
        return (this.mutableIncoming.get(nodeId) || []).map(clone);
    }
    getRelationships(nodeId) {
        return (this.mutableAll.get(nodeId) || []).map(clone);
    }
    getNeighborIds(nodeId) {
        return new Set(this.mutableNeighbors.get(nodeId) || []);
    }
    searchAllTokens(tokens) {
        return this.searchIndex.searchAnd(new Set(tokens));
    }
    search(query, type) {
        const queryTokens = new Set();
        tokenize(query, queryTokens);
        if (queryTokens.size === 0)
            return [];
        let candidateIds = this.searchIndex.search(queryTokens);
        if (type) {
            const typeNodes = this.mutableByType.get(type);
            if (!typeNodes)
                return [];
            const typeIdSet = new Set(typeNodes.map(n => n.id));
            candidateIds = candidateIds.filter(id => typeIdSet.has(id));
        }
        return candidateIds
            .map(id => this.mutableById.get(id) ? clone(this.mutableById.get(id)) : undefined)
            .filter((n) => n !== undefined);
    }
}
function clone(value) {
    return structuredClone(value);
}
/**
 * Inverted index for fast text search.
 * Supports incremental add/remove.
 */
export class InvertedIndex {
    index = new Map();
    add(nodeId, tokens) {
        for (const token of tokens) {
            const existing = this.index.get(token);
            if (existing)
                existing.add(nodeId);
            else
                this.index.set(token, new Set([nodeId]));
        }
    }
    remove(nodeId) {
        for (const [, nodeIds] of this.index) {
            nodeIds.delete(nodeId);
        }
    }
    search(queryTokens) {
        const resultIds = new Set();
        for (const token of queryTokens) {
            const matches = this.index.get(token);
            if (matches) {
                for (const id of matches)
                    resultIds.add(id);
            }
        }
        return [...resultIds];
    }
    searchAnd(queryTokens) {
        const arrays = [];
        for (const token of queryTokens) {
            const matches = this.index.get(token);
            if (!matches || matches.size === 0)
                return [];
            arrays.push([...matches]);
        }
        if (arrays.length === 0)
            return [];
        arrays.sort((a, b) => a.length - b.length);
        let result = new Set(arrays[0]);
        for (let i = 1; i < arrays.length; i++) {
            const currentSet = new Set(arrays[i]);
            result = new Set([...result].filter(id => currentSet.has(id)));
            if (result.size === 0)
                return [];
        }
        return [...result];
    }
}
// ── Utility ──────────────────────────────────────────────────────────
function tokenize(text, output) {
    const normalized = text
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024F]+/g, " ")
        .trim();
    for (const word of normalized.split(/\s+/)) {
        if (word.length > 1) {
            output.add(word);
            const stemmed = stem(word);
            if (stemmed !== word)
                output.add(stemmed);
        }
    }
}
function stem(word) {
    if (word.length <= 4)
        return word;
    const suffixes = [
        "mentes", "mento", "ções", "ção", "mente", "avel", "ivel",
        "ments", "tion", "ness", "able", "ible", "ling",
        "ated", "ting", "ship", "less", "ence", "ance",
        "ised", "ized", "ally", "ical",
        "es", "ed", "er", "ly", "ing", "ion", "al", "en", "s",
    ];
    for (const suffix of suffixes) {
        if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
            return word.slice(0, -suffix.length);
        }
    }
    return word;
}
// ── Per-Type Graph Cache ─────────────────────────────────────────────
/**
 * Granular graph cache that stores nodes by type separately.
 * Only the affected type is invalidated on mutation.
 */
export class PerTypeGraphCache {
    nodesByType = new Map();
    relationships = [];
    graphFingerprint = "";
    /**
     * Get nodes of a specific type from cache.
     * Returns null if cache miss for that type.
     */
    getNodesByType(type, currentFingerprint) {
        if (currentFingerprint !== this.graphFingerprint)
            return null;
        return structuredClone(this.nodesByType.get(type) || []);
    }
    /**
     * Get all relationships from cache.
     */
    getRelationships(currentFingerprint) {
        if (currentFingerprint !== this.graphFingerprint)
            return null;
        return structuredClone(this.relationships);
    }
    /**
     * Populate cache for a specific type only.
     */
    setType(type, nodes, fingerprint) {
        this.nodesByType.set(type, structuredClone(nodes));
        this.graphFingerprint = fingerprint;
    }
    /**
     * Set relationships cache.
     */
    setRelationships(rels, fingerprint) {
        this.relationships = structuredClone(rels);
        this.graphFingerprint = fingerprint;
    }
    /**
     * Invalidate only a specific type.
     */
    invalidateType(type) {
        this.nodesByType.delete(type);
    }
    /**
     * Invalidate relationships.
     */
    invalidateRelationships() {
        this.relationships = [];
    }
    /**
     * Full invalidation (all types).
     */
    invalidateAll() {
        this.nodesByType.clear();
        this.relationships = [];
        this.graphFingerprint = "";
    }
    /**
     * Check if cache is valid for a given version.
     */
    isValid(fingerprint) {
        return fingerprint === this.graphFingerprint;
    }
}
export function computeDirtyState(oldGraph, newGraph) {
    if (!oldGraph) {
        return { dirtyNodeIds: new Set(), dirtyTypes: new Set(), allChanged: true };
    }
    const dirtyNodeIds = new Set();
    const dirtyTypes = new Set();
    const oldNodeIds = new Set(oldGraph.nodes.map(n => n.id));
    const newNodeIds = new Set(newGraph.nodes.map(n => n.id));
    for (const node of newGraph.nodes) {
        if (!oldNodeIds.has(node.id)) {
            dirtyNodeIds.add(node.id);
            dirtyTypes.add(node.type);
        }
    }
    for (const node of oldGraph.nodes) {
        if (!newNodeIds.has(node.id)) {
            dirtyNodeIds.add(node.id);
            dirtyTypes.add(node.type);
        }
    }
    const oldNodeMap = new Map(oldGraph.nodes.map(n => [n.id, n]));
    for (const node of newGraph.nodes) {
        const old = oldNodeMap.get(node.id);
        if (old && old.version !== node.version) {
            dirtyNodeIds.add(node.id);
            dirtyTypes.add(node.type);
        }
    }
    if (oldGraph.relationships.length !== newGraph.relationships.length) {
        return { dirtyNodeIds, dirtyTypes, allChanged: true };
    }
    const oldRelKeys = new Set(oldGraph.relationships.map(r => `${r.from}||${r.to}||${r.type}`));
    for (const rel of newGraph.relationships) {
        const key = `${rel.from}||${rel.to}||${rel.type}`;
        if (!oldRelKeys.has(key)) {
            dirtyNodeIds.add(rel.from);
            dirtyNodeIds.add(rel.to);
        }
    }
    const expandedDirty = new Set(dirtyNodeIds);
    const relIndex = new Map();
    for (const rel of newGraph.relationships) {
        if (!relIndex.has(rel.from))
            relIndex.set(rel.from, new Set());
        if (!relIndex.has(rel.to))
            relIndex.set(rel.to, new Set());
        relIndex.get(rel.from).add(rel.to);
        relIndex.get(rel.to).add(rel.from);
    }
    for (const dirtyId of dirtyNodeIds) {
        const adjacent = relIndex.get(dirtyId);
        if (adjacent) {
            for (const adjId of adjacent)
                expandedDirty.add(adjId);
        }
    }
    // Adaptive threshold: larger graphs tolerate higher % of dirty nodes
    // before falling back to full validation
    const adaptiveThreshold = computeAdaptiveThreshold(newGraph.nodes.length, dirtyNodeIds.size, dirtyTypes);
    return {
        dirtyNodeIds: expandedDirty,
        dirtyTypes,
        allChanged: dirtyNodeIds.size > newGraph.nodes.length * adaptiveThreshold,
    };
}
/**
 * Compute an adaptive threshold for deciding when to fall back to full validation.
 *
 * Strategy:
 * - Small graphs (<50 nodes): conservative, fall back at 30%
 * - Medium graphs (50-200): moderate, fall back at 20%
 * - Large graphs (>200): permissive, fall back at 10%
 * - Metadata-only changes (no structural types): +15% more tolerance
 * - Structural changes (types/relationships): -10% less tolerance
 */
function computeAdaptiveThreshold(graphSize, _dirtyCount, dirtyTypes) {
    // Base threshold by graph size
    let threshold;
    if (graphSize < 50) {
        threshold = 0.30;
    }
    else if (graphSize < 200) {
        threshold = 0.20;
    }
    else {
        threshold = 0.10;
    }
    // Adjust for change type
    const STRUCTURAL_TYPES = new Set([
        "architecture_component", "database", "table",
        "constitution", "deprecation", "migration",
    ]);
    const METADATA_ONLY_TYPES = new Set([
        "task", "test", "decision", "constraint", "assumption",
        "metric", "alert", "sla",
    ]);
    let hasStructural = false;
    let hasMetadataOnly = true;
    for (const t of dirtyTypes) {
        if (STRUCTURAL_TYPES.has(t))
            hasStructural = true;
        if (!METADATA_ONLY_TYPES.has(t))
            hasMetadataOnly = false;
    }
    if (hasMetadataOnly && dirtyTypes.size > 0) {
        threshold += 0.15; // More tolerance for metadata-only changes
    }
    if (hasStructural) {
        threshold -= 0.10; // Less tolerance for structural changes
    }
    // Clamp between 5% and 50%
    return Math.max(0.05, Math.min(0.5, threshold));
}
