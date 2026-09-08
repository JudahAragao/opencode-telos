import { getNodesByType } from "../graph/engine.js";
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js";
import { classifyPromiseVerifiability } from "./classifier.js";
export function extractPromises(graph, options) {
    const promises = [];
    const { removed, deprecated } = getExclusionSets(graph);
    const autoClassify = options?.autoClassify ?? true;
    const customRules = options?.customRules;
    // Build a map of persisted promise states from node metadata
    const persistedStates = buildPersistedPromiseStates(graph);
    const requirements = getNodesByType(graph, "requirement")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated));
    for (const req of requirements) {
        const criteria = req.metadata.acceptance_criteria || [];
        for (let i = 0; i < criteria.length; i++) {
            const criterion = criteria[i];
            if (typeof criterion !== "string")
                continue;
            const promiseId = `PRM-${req.id}-${String(i + 1).padStart(3, "0")}`;
            const persisted = persistedStates.get(promiseId);
            let status = persisted?.status || "pending";
            // Auto-classify unverifiable if infrastructure is missing
            if (autoClassify && status === "pending") {
                const classification = classifyPromiseVerifiability(criterion, graph, customRules);
                if (!classification.verifiable) {
                    status = "unverifiable";
                }
            }
            promises.push({
                id: promiseId,
                description: criterion,
                source_node_id: req.id,
                status,
                evidence: persisted?.evidence,
                verified_at: persisted?.verified_at,
            });
        }
        if (criteria.length === 0 && req.description) {
            const promiseId = `PRM-${req.id}-DESC`;
            const persisted = persistedStates.get(promiseId);
            let status = persisted?.status || "pending";
            if (autoClassify && status === "pending") {
                const classification = classifyPromiseVerifiability(req.description, graph, customRules);
                if (!classification.verifiable) {
                    status = "unverifiable";
                }
            }
            promises.push({
                id: promiseId,
                description: req.description,
                source_node_id: req.id,
                status,
                evidence: persisted?.evidence,
                verified_at: persisted?.verified_at,
            });
        }
    }
    const rules = getNodesByType(graph, "business_rule")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated));
    for (const rule of rules) {
        if (rule.metadata.rule_text) {
            const promiseId = `PRM-${rule.id}`;
            const persisted = persistedStates.get(promiseId);
            let status = persisted?.status || "pending";
            if (autoClassify && status === "pending") {
                const classification = classifyPromiseVerifiability(rule.metadata.rule_text, graph, customRules);
                if (!classification.verifiable) {
                    status = "unverifiable";
                }
            }
            promises.push({
                id: promiseId,
                description: rule.metadata.rule_text,
                source_node_id: rule.id,
                status,
                evidence: persisted?.evidence,
                verified_at: persisted?.verified_at,
            });
        }
    }
    return promises;
}
/**
 * Build a map of persisted promise states from node metadata.
 * Promise states are stored in the node's metadata.promise_states object.
 */
function buildPersistedPromiseStates(graph) {
    const states = new Map();
    // Check requirement nodes for promise states
    const requirements = graph.nodes.filter(n => n.type === "requirement");
    for (const req of requirements) {
        const meta = req.metadata;
        const promiseStates = meta.promise_states;
        if (promiseStates) {
            for (const [promiseId, state] of Object.entries(promiseStates)) {
                states.set(promiseId, state);
            }
        }
    }
    // Check business_rule nodes for promise states
    const rules = graph.nodes.filter(n => n.type === "business_rule");
    for (const rule of rules) {
        const meta = rule.metadata;
        const promiseStates = meta.promise_states;
        if (promiseStates) {
            for (const [promiseId, state] of Object.entries(promiseStates)) {
                states.set(promiseId, state);
            }
        }
    }
    return states;
}
export function verifyPromise(graph, promiseId, evidence) {
    const allPromises = extractPromises(graph);
    const promise = allPromises.find((p) => p.id === promiseId);
    if (!promise)
        return null;
    promise.status = "fulfilled";
    promise.evidence = evidence;
    promise.verified_at = new Date().toISOString();
    // Persist the state in the source node's metadata
    persistPromiseState(graph, promise.source_node_id, promiseId, {
        status: "fulfilled",
        evidence,
        verified_at: promise.verified_at,
    });
    return promise;
}
export function markPromiseViolated(graph, promiseId) {
    const allPromises = extractPromises(graph);
    const promise = allPromises.find((p) => p.id === promiseId);
    if (!promise)
        return null;
    promise.status = "violated";
    promise.verified_at = new Date().toISOString();
    // Persist the state in the source node's metadata
    persistPromiseState(graph, promise.source_node_id, promiseId, {
        status: "violated",
        verified_at: promise.verified_at,
    });
    return promise;
}
/**
 * Persist a promise state in the source node's metadata.
 * This ensures promise verification survives session restarts.
 */
function persistPromiseState(graph, sourceNodeId, promiseId, state) {
    const node = graph.nodes.find(n => n.id === sourceNodeId);
    if (!node)
        return;
    const meta = node.metadata;
    if (!meta.promise_states) {
        meta.promise_states = {};
    }
    ;
    meta.promise_states[promiseId] = state;
    // Update graph timestamp for cross-process cache invalidation
    graph.metadata.updated_at = new Date().toISOString();
}
export function getPromiseReport(graph) {
    const promises = extractPromises(graph);
    const pending = promises.filter((p) => p.status === "pending").length;
    const fulfilled = promises.filter((p) => p.status === "fulfilled").length;
    const violated = promises.filter((p) => p.status === "violated").length;
    const unverifiable = promises.filter((p) => p.status === "unverifiable").length;
    const verifiable = promises.length - unverifiable;
    return {
        total: promises.length,
        pending,
        fulfilled,
        violated,
        unverifiable,
        fulfillment_rate: verifiable > 0 ? fulfilled / verifiable : 1,
        promises,
    };
}
export function formatPromiseReport(report) {
    const lines = [
        `## Promise Report`,
        `**Total:** ${report.total}`,
        `**Pending:** ${report.pending}`,
        `**Fulfilled:** ${report.fulfilled}`,
        `**Violated:** ${report.violated}`,
        `**Unverifiable:** ${report.unverifiable}`,
        `**Fulfillment Rate:** ${(report.fulfillment_rate * 100).toFixed(1)}%`,
    ];
    if (report.violated > 0) {
        lines.push("\n### Violated Promises");
        for (const p of report.promises.filter((p) => p.status === "violated")) {
            lines.push(`- **${p.id}** (${p.source_node_id}): ${p.description}`);
        }
    }
    if (report.pending > 0) {
        lines.push("\n### Pending Promises");
        for (const p of report.promises.filter((p) => p.status === "pending").slice(0, 10)) {
            lines.push(`- **${p.id}** (${p.source_node_id}): ${p.description}`);
        }
        if (report.pending > 10) {
            lines.push(`- ... and ${report.pending - 10} more`);
        }
    }
    return lines.join("\n");
}
