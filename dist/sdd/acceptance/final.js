import { getNode, updateNode } from "../graph/engine.js";
export function transitionFinalAcceptance(graph, changeId, status, input) {
    const node = getNode(graph, changeId);
    if (!node || node.type !== "change")
        throw new Error(`Change ${changeId} not found`);
    const change = node;
    if (input.expected_version !== undefined && change.version !== input.expected_version) {
        throw new Error(`Change ${changeId} version conflict: expected ${input.expected_version}, current ${change.version}`);
    }
    const current = change.metadata.final_acceptance?.status || "PENDING";
    const timestamp = new Date().toISOString();
    const updated = updateNode(graph, changeId, {
        metadata: {
            ...change.metadata,
            final_acceptance: {
                status,
                actor: input.actor,
                accepted_at: timestamp,
                observation: input.observation,
                evidence: input.evidence,
                previous_status: current,
            },
        },
    });
    return { change: updated, previous_status: current, status, actor: input.actor, timestamp };
}
export function getFinalAcceptanceStatus(change) {
    return change.metadata.final_acceptance?.status || "PENDING";
}
