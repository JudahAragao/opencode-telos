import { createHash } from "crypto";
import { getNodesByType } from "../graph/engine.js";
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js";
import { classifyPromiseVerifiability } from "./classifier.js";
import { fileContentFingerprint } from "../cache/fingerprint.js";
import { join } from "path";
import { getAcceptanceCriteria } from "../acceptance/service.js";
/** Stable identity: reordering acceptance criteria must not change the promise. */
export function stablePromiseId(sourceNodeId, description, kind = "criterion") {
    const digest = createHash("sha256")
        .update(`${sourceNodeId}\n${kind}\n${description.trim().replace(/\s+/g, " ")}`)
        .digest("hex")
        .slice(0, 12);
    return `PRM-${sourceNodeId}-${digest}`;
}
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
        const criteria = getAcceptanceCriteria(graph, req.id, true);
        for (let i = 0; i < criteria.length; i++) {
            const criterion = criteria[i].metadata.text;
            const promiseId = stablePromiseId(req.id, criterion);
            const persisted = persistedStates.get(promiseId) || persistedStates.get(`PRM-${req.id}-${String(i + 1).padStart(3, "0")}`);
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
                evidence_refs: persisted?.evidence_refs,
                violation_reason: persisted?.violation_reason,
                verified_by_execution_id: persisted?.verified_by_execution_id,
                verified_at: persisted?.verified_at,
            });
        }
        if (criteria.length === 0 && req.description) {
            const promiseId = stablePromiseId(req.id, req.description, "description");
            const persisted = persistedStates.get(promiseId) || persistedStates.get(`PRM-${req.id}-DESC`);
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
                evidence_refs: persisted?.evidence_refs,
                violation_reason: persisted?.violation_reason,
                verified_by_execution_id: persisted?.verified_by_execution_id,
                verified_at: persisted?.verified_at,
            });
        }
    }
    const rules = getNodesByType(graph, "business_rule")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated));
    for (const rule of rules) {
        if (rule.metadata.rule_text) {
            const promiseId = stablePromiseId(rule.id, rule.metadata.rule_text, "business_rule");
            const persisted = persistedStates.get(promiseId) || persistedStates.get(`PRM-${rule.id}`);
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
                evidence_refs: persisted?.evidence_refs,
                violation_reason: persisted?.violation_reason,
                verified_by_execution_id: persisted?.verified_by_execution_id,
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
export function verifyPromise(graph, promiseId, input) {
    const verification = typeof input === "string" ? { evidence: input } : input;
    if (!verification.evidence.trim())
        return null;
    if (!verification.evidence_refs || verification.evidence_refs.length === 0)
        return null;
    const allPromises = extractPromises(graph);
    const promise = allPromises.find((p) => p.id === promiseId);
    if (!promise)
        return null;
    for (const ref of verification.evidence_refs) {
        if (!ref.id || (ref.type === "file" && !ref.fingerprint))
            return null;
        if (ref.type === "execution")
            continue;
        const node = graph.nodes.find((candidate) => candidate.id === ref.id);
        if (!node || (ref.type === "test" && node.type !== "test") || (ref.type === "file" && node.type !== "file") || (ref.type === "change" && node.type !== "change"))
            return null;
        if (ref.type === "test" && !graph.relationships.some((relationship) => relationship.from === promise.source_node_id && relationship.to === ref.id && relationship.type === "tested_by"))
            return null;
        if (ref.type === "file" && ref.fingerprint) {
            const path = typeof node.metadata.path === "string"
                ? String(node.metadata.path)
                : ref.path;
            if (path && verification.project_dir && ref.fingerprint !== fileContentFingerprint(join(verification.project_dir, path)))
                return null;
        }
    }
    promise.status = "fulfilled";
    promise.evidence = verification.evidence;
    promise.evidence_refs = verification.evidence_refs;
    promise.verified_by_execution_id = verification.execution_id;
    promise.verified_at = new Date().toISOString();
    // Persist the state in the source node's metadata
    persistPromiseState(graph, promise.source_node_id, promiseId, {
        status: "fulfilled",
        evidence: verification.evidence,
        evidence_refs: verification.evidence_refs,
        verified_by_execution_id: verification.execution_id,
        verified_at: promise.verified_at,
    });
    return promise;
}
export function markPromiseViolated(graph, promiseId, reason = "Violation reported without a detailed reason.") {
    const allPromises = extractPromises(graph);
    const promise = allPromises.find((p) => p.id === promiseId);
    if (!promise)
        return null;
    promise.status = "violated";
    promise.violation_reason = reason;
    promise.verified_at = new Date().toISOString();
    // Persist the state in the source node's metadata
    persistPromiseState(graph, promise.source_node_id, promiseId, {
        status: "violated",
        violation_reason: reason,
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
