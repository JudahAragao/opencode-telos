import { addNode, addRelationship, getNode, updateNode } from "../graph/engine.js";
import { analyzeNodeImpact } from "../impact/service.js";
import { updateAcceptanceCriterionText } from "../acceptance/service.js";
function now() {
    return new Date().toISOString();
}
function guidanceId(graph) {
    const prefix = `${graph.project_id}-GUIDE-`;
    const used = new Set(graph.nodes.filter((node) => node.type === "guidance").map((node) => node.id));
    let count = graph.nodes.filter((node) => node.type === "guidance").length + 1;
    let id = `${prefix}${String(count).padStart(4, "0")}`;
    while (used.has(id)) {
        count++;
        id = `${prefix}${String(count).padStart(4, "0")}`;
    }
    return id;
}
export function createGuidance(graph, targetNodeId, input) {
    const target = getNode(graph, targetNodeId);
    if (!target)
        throw new Error(`Target node ${targetNodeId} not found`);
    if (!input.instruction.trim())
        throw new Error("Guidance instruction cannot be empty");
    const timestamp = now();
    const guidance = {
        id: guidanceId(graph),
        type: "guidance",
        name: `Guidance for ${target.name}`,
        description: input.instruction,
        status: "DRAFT",
        version: 1,
        metadata: {
            instruction: input.instruction.trim(),
            target_node_id: targetNodeId,
            requested_by: input.requested_by,
            priority: input.priority || "medium",
            scope: input.scope,
            status: "OPEN",
        },
        created_at: timestamp,
        updated_at: timestamp,
        created_by: input.requested_by,
    };
    addNode(graph, guidance);
    addRelationship(graph, guidance.id, targetNodeId, "guides", { source: "human_guidance" });
    try {
        addRelationship(graph, graph.project_id, guidance.id, "contains", { source: "human_guidance" });
    }
    catch { }
    return guidance;
}
export function analyzeGuidance(graph, guidanceId, maxDepth = 5) {
    const node = getNode(graph, guidanceId);
    if (!node || node.type !== "guidance")
        throw new Error(`Guidance ${guidanceId} not found`);
    const guidance = node;
    const impact = analyzeNodeImpact(graph, guidance.metadata.target_node_id, maxDepth);
    updateNode(graph, guidanceId, {
        metadata: {
            ...guidance.metadata,
            status: "ANALYZED",
            impact_node_ids: [...new Set([
                    ...impact.direct.map((item) => item.node.id),
                    ...impact.indirect.map((item) => item.node.id),
                    ...impact.potential.map((item) => item.node.id),
                ])],
        },
    });
    return { guidance: getNode(graph, guidanceId), impact };
}
export function proposeGuidancePatch(graph, guidanceId, proposal) {
    const node = getNode(graph, guidanceId);
    if (!node || node.type !== "guidance")
        throw new Error(`Guidance ${guidanceId} not found`);
    const guidance = node;
    return updateNode(graph, guidanceId, {
        metadata: { ...guidance.metadata, status: "PROPOSED", proposal },
    });
}
export function applyGuidancePatch(graph, guidanceId, proposal, actor, expectedTargetVersion) {
    // Work on an isolated graph so a failed propagated update cannot partially
    // mutate the caller's graph before the repository commit.
    const working = structuredClone(graph);
    const node = getNode(working, guidanceId);
    if (!node || node.type !== "guidance")
        throw new Error(`Guidance ${guidanceId} not found`);
    let guidance = node;
    const target = getNode(working, guidance.metadata.target_node_id);
    if (!target)
        throw new Error(`Guidance target ${guidance.metadata.target_node_id} not found`);
    if (!guidance.metadata.impact_node_ids) {
        guidance = analyzeGuidance(working, guidanceId).guidance;
    }
    if (expectedTargetVersion !== undefined && target.version !== expectedTargetVersion) {
        throw new Error(`Guidance target version conflict: expected ${expectedTargetVersion}, current ${target.version}`);
    }
    const impactIds = new Set([guidance.metadata.target_node_id, ...(guidance.metadata.impact_node_ids || [])]);
    const propagated = Array.isArray(proposal.updates)
        ? proposal.updates.filter((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item))
                return false;
            const value = item;
            return typeof value.node_id === "string" && !!value.patch && typeof value.patch === "object" && !Array.isArray(value.patch);
        })
        : [];
    for (const update of propagated) {
        if (!impactIds.has(update.node_id))
            throw new Error(`Guidance propagation target ${update.node_id} was not identified by impact analysis`);
        const affected = getNode(working, update.node_id);
        if (!affected)
            throw new Error(`Guidance propagation target ${update.node_id} not found`);
        if (update.expected_version !== undefined && affected.version !== update.expected_version) {
            throw new Error(`Guidance propagation target version conflict: ${update.node_id}`);
        }
    }
    const applyOne = (nodeToUpdate, patchToApply) => {
        if (nodeToUpdate.type === "acceptance_criterion") {
            if (typeof patchToApply.text !== "string")
                throw new Error(`Acceptance criterion guidance for ${nodeToUpdate.id} must provide a text update`);
            return updateAcceptanceCriterionText(working, nodeToUpdate.id, patchToApply.text, {
                actor,
                observation: typeof patchToApply.observation === "string" ? patchToApply.observation : undefined,
            });
        }
        const updates = {};
        for (const key of ["name", "description", "status"]) {
            if (patchToApply[key] !== undefined)
                updates[key] = patchToApply[key];
        }
        if (patchToApply.metadata && typeof patchToApply.metadata === "object" && !Array.isArray(patchToApply.metadata)) {
            const metadataPatch = patchToApply.metadata;
            const protectedKeys = ["accepted_by", "accepted_at", "criterion_version", "content_hash", "previous_hash", "target_node_id", "impact_node_ids", "applied_target_ids", "applied_at"];
            const protectedKey = Object.keys(metadataPatch).find((key) => protectedKeys.includes(key));
            if (protectedKey)
                throw new Error(`Guidance cannot directly modify protected metadata field ${protectedKey}`);
            updates.metadata = {
                ...nodeToUpdate.metadata,
                ...patchToApply.metadata,
            };
        }
        if (Object.keys(updates).length === 0)
            throw new Error(`Guidance proposal contains no supported updates for ${nodeToUpdate.id}`);
        return updateNode(working, nodeToUpdate.id, { ...updates, created_by: actor });
    };
    const hasSupportedPatch = (nodeToUpdate, patchToApply) => {
        if (nodeToUpdate.type === "acceptance_criterion")
            return typeof patchToApply.text === "string";
        return ["name", "description", "status", "metadata"].some((key) => {
            const value = patchToApply[key];
            return key === "metadata" ? !!value && typeof value === "object" && !Array.isArray(value) : value !== undefined;
        });
    };
    if (!hasSupportedPatch(target, proposal))
        throw new Error(`Guidance proposal contains no supported updates for ${target.id}`);
    for (const update of propagated) {
        if (!hasSupportedPatch(getNode(working, update.node_id), update.patch))
            throw new Error(`Guidance proposal contains no supported updates for ${update.node_id}`);
    }
    if (target.type === "acceptance_criterion") {
        const updatedTarget = applyOne(target, proposal);
        for (const update of propagated)
            applyOne(getNode(working, update.node_id), update.patch);
        const updatedGuidance = updateNode(working, guidanceId, {
            metadata: { ...guidance.metadata, status: "APPLIED", proposal, applied_target_ids: [target.id, ...propagated.map((update) => update.node_id)], applied_at: now() },
            created_by: actor,
        });
        graph.nodes = working.nodes;
        graph.relationships = working.relationships;
        graph.metadata = working.metadata;
        return { guidance: updatedGuidance, target: updatedTarget };
    }
    const updatedTarget = applyOne(target, proposal);
    for (const update of propagated)
        applyOne(getNode(working, update.node_id), update.patch);
    const updatedGuidance = updateNode(working, guidanceId, {
        metadata: {
            ...guidance.metadata,
            status: "APPLIED",
            proposal,
            applied_target_ids: [target.id, ...propagated.map((update) => update.node_id)],
            applied_at: now(),
        },
        created_by: actor,
    });
    graph.nodes = working.nodes;
    graph.relationships = working.relationships;
    graph.metadata = working.metadata;
    return { guidance: updatedGuidance, target: updatedTarget };
}
export function rejectGuidance(graph, guidanceId, actor, resolution) {
    const node = getNode(graph, guidanceId);
    if (!node || node.type !== "guidance")
        throw new Error(`Guidance ${guidanceId} not found`);
    return updateNode(graph, guidanceId, {
        metadata: { ...node.metadata, status: "REJECTED", resolution },
        created_by: actor,
    });
}
