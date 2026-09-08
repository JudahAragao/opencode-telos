import { getNode, addNode, updateNode } from "../graph/engine.js";
import { computeImpact } from "../graph/traverse.js";
import { extractPromises } from "../promises/tracker.js";
let changeCounter = 0;
function nextChangeId(graph) {
    const existing = graph.nodes.filter((n) => n.type === "change");
    changeCounter = existing.length + 1;
    return `CHG-${String(changeCounter).padStart(3, "0")}`;
}
export function classifyApprovalLevel(proposal, graph) {
    const affectedNodes = proposal.affected_node_ids
        .map((id) => getNode(graph, id))
        .filter(Boolean);
    const hasArchitectureChange = affectedNodes.some((n) => n.type === "architecture_component" ||
        n.type === "database" ||
        n.type === "api");
    const hasEntityChange = affectedNodes.some((n) => n.type === "entity");
    const hasDestructive = proposal.removed_node_ids.length > 0;
    if (hasDestructive)
        return "BLOCKED";
    if (hasArchitectureChange)
        return "APPROVAL";
    if (hasEntityChange)
        return "REVIEW";
    if (proposal.new_nodes.length <= 2 && proposal.modified_nodes.length <= 2)
        return "AUTO";
    return "REVIEW";
}
export function createChange(graph, proposal, options) {
    const now = new Date().toISOString();
    const id = nextChangeId(graph);
    const approvalLevel = classifyApprovalLevel(proposal, graph);
    const depth = options?.maxImpactDepth ?? 3;
    const impact = new Map();
    const nodesToAnalyze = options?.focusAffectedNodes
        ? proposal.affected_node_ids.filter((n) => options.focusAffectedNodes.includes(n))
        : proposal.affected_node_ids;
    for (const nodeId of nodesToAnalyze) {
        if (options?.skipImpactAnalysis) {
            impact.set(nodeId, []);
            continue;
        }
        const cached = options?.impactCache?.get(nodeId);
        if (cached) {
            impact.set(nodeId, cached);
            continue;
        }
        const result = computeImpact(graph, nodeId, depth);
        const impacted = [...result.direct, ...result.indirect];
        impact.set(nodeId, impacted);
        options?.impactCache?.set(nodeId, impacted);
    }
    const allAffected = new Set(proposal.affected_node_ids);
    for (const nodes of impact.values()) {
        for (const n of nodes)
            allAffected.add(n.id);
    }
    const changeNode = {
        id,
        type: "change",
        name: proposal.title,
        description: proposal.reason,
        status: "DRAFT",
        version: 1,
        metadata: {
            title: proposal.title,
            reason: proposal.reason,
            approval_level: approvalLevel,
            affected_nodes: [...allAffected],
            affected_relationships: [],
            new_nodes: proposal.new_nodes.map((n) => n.id || "pending"),
            removed_nodes: proposal.removed_node_ids,
            modified_nodes: proposal.modified_nodes.map((m) => m.id),
            affected_files: proposal.affected_files,
            affected_tests: proposal.affected_tests,
            implementation_tasks: proposal.implementation_tasks,
            origin: "CONVERSATION",
            transaction_id: `TX-${Date.now()}`,
        },
        created_at: now,
        updated_at: now,
        change_id: id,
    };
    addNode(graph, changeNode);
    for (const nodeUpdate of proposal.modified_nodes) {
        try {
            updateNode(graph, nodeUpdate.id, {
                ...nodeUpdate.updates,
                change_id: id,
            });
        }
        catch {
            // Node might not exist yet if it's a new node
        }
    }
    return changeNode;
}
export function approveChange(graph, changeId) {
    const node = getNode(graph, changeId);
    if (!node || node.type !== "change")
        throw new Error(`Change ${changeId} not found`);
    updateNode(graph, changeId, { status: "APPROVED" });
}
/**
 * Check if a change can be completed. Blocks if there are pending promises
 * on nodes affected by the change that haven't been verified.
 */
export function checkChangeCompletion(graph, changeId, options) {
    const node = getNode(graph, changeId);
    if (!node || node.type !== "change") {
        return { allowed: false, reason: `Change ${changeId} not found`, pending_promises: [] };
    }
    const change = node;
    const allAffectedIds = change.metadata.affected_nodes || [];
    const affectedIds = new Set(options?.focusAffectedNodes
        ? allAffectedIds.filter((id) => options.focusAffectedNodes.includes(id))
        : allAffectedIds);
    // Find all promises whose source nodes are affected by this change
    const cacheKey = `promises_${graph.nodes.length}_${graph.relationships.length}`;
    let allPromises;
    if (options?.promiseCache?.has(cacheKey)) {
        allPromises = options.promiseCache.get(cacheKey);
    }
    else {
        allPromises = extractPromises(graph);
        options?.promiseCache?.set(cacheKey, allPromises);
    }
    const pendingOnAffected = allPromises.filter((p) => p.status === "pending" && affectedIds.has(p.source_node_id));
    if (pendingOnAffected.length === 0) {
        return { allowed: true, reason: "", pending_promises: [] };
    }
    return {
        allowed: false,
        reason: `${pendingOnAffected.length} pending promise(s) on affected nodes must be verified before completing this change.`,
        pending_promises: pendingOnAffected.map((p) => ({
            id: p.id,
            description: p.description,
            source_node_id: p.source_node_id,
        })),
    };
}
export function completeChange(graph, changeId) {
    const node = getNode(graph, changeId);
    if (!node || node.type !== "change")
        throw new Error(`Change ${changeId} not found`);
    updateNode(graph, changeId, { status: "COMPLETED" });
}
/**
 * Complete a change with promise validation. Returns a result indicating
 * whether the completion was allowed or blocked by pending promises.
 */
export function completeChangeWithPromiseCheck(graph, changeId, force = false) {
    if (!force) {
        const check = checkChangeCompletion(graph, changeId);
        if (!check.allowed) {
            return { completed: false, result: check };
        }
    }
    completeChange(graph, changeId);
    return {
        completed: true,
        result: { allowed: true, reason: "", pending_promises: [] },
    };
}
export function failChange(graph, changeId, reason) {
    const node = getNode(graph, changeId);
    if (!node || node.type !== "change")
        throw new Error(`Change ${changeId} not found`);
    updateNode(graph, changeId, {
        status: "FAILED",
        description: `${node.description || ""}\n\nFailure reason: ${reason}`,
    });
}
export function getPendingChanges(graph) {
    return graph.nodes.filter((n) => n.type === "change" &&
        ["DRAFT", "PROPOSED", "APPROVED"].includes(n.status));
}
export function getChangeHistory(graph) {
    return graph.nodes
        .filter((n) => n.type === "change")
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export function formatImpactReport(graph, changeId) {
    const change = getNode(graph, changeId);
    if (!change)
        return `Change ${changeId} not found`;
    const lines = [
        `## Impact Report: ${change.metadata.title}\n`,
        `**ID:** ${change.id}`,
        `**Status:** ${change.status}`,
        `**Approval Level:** ${change.metadata.approval_level}`,
        `**Reason:** ${change.metadata.reason}\n`,
        "### Affected Nodes",
    ];
    for (const nodeId of change.metadata.affected_nodes) {
        const node = getNode(graph, nodeId);
        if (node) {
            lines.push(`- ${node.id} (${node.type}): ${node.name}`);
        }
    }
    if (change.metadata.new_nodes.length > 0) {
        lines.push("\n### New Nodes");
        for (const nodeId of change.metadata.new_nodes) {
            lines.push(`- ${nodeId}`);
        }
    }
    if (change.metadata.modified_nodes.length > 0) {
        lines.push("\n### Modified Nodes");
        for (const nodeId of change.metadata.modified_nodes) {
            const node = getNode(graph, nodeId);
            if (node)
                lines.push(`- ${node.id} (${node.type}): ${node.name}`);
        }
    }
    if (change.metadata.removed_nodes.length > 0) {
        lines.push("\n### Removed Nodes");
        for (const nodeId of change.metadata.removed_nodes) {
            lines.push(`- ${nodeId}`);
        }
    }
    if (change.metadata.affected_files.length > 0) {
        lines.push("\n### Affected Files");
        for (const file of change.metadata.affected_files) {
            lines.push(`- ${file}`);
        }
    }
    if (change.metadata.affected_tests.length > 0) {
        lines.push("\n### Affected Tests");
        for (const test of change.metadata.affected_tests) {
            lines.push(`- ${test}`);
        }
    }
    return lines.join("\n");
}
