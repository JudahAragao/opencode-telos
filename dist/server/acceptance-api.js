import { z } from "zod";
import { createRepository, loadSddConfig } from "../sdd/persistence/repository.js";
import { AcceptanceService, materializeLegacyAcceptanceCriteria, updateAcceptanceCriterionText } from "../sdd/acceptance/service.js";
import { addAuditEntry, checkPermission, getUserRoleWithAuth } from "../sdd/permissions/access.js";
import { analyzeNodeImpact } from "../sdd/impact/service.js";
import { analyzeGuidance, applyGuidancePatch, createGuidance, proposeGuidancePatch, rejectGuidance } from "../sdd/guidance/service.js";
const mutationSchema = z.object({
    actor: z.string().min(1).max(200).optional(),
    observation: z.string().max(8000).optional(),
    evidence: z.array(z.record(z.unknown())).max(100).optional(),
    expected_version: z.number().int().nonnegative().optional(),
    expected_hash: z.string().max(200).optional(),
});
const guidanceSchema = z.object({
    actor: z.string().min(1).max(200).optional(),
    instruction: z.string().min(1).max(12000).optional(),
    proposal: z.record(z.unknown()).optional(),
    expected_target_version: z.number().int().nonnegative().optional(),
    resolution: z.string().max(8000).optional(),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    scope: z.string().max(4000).optional(),
});
function error(error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: /not found/i.test(message) ? 404 : /conflict/i.test(message) ? 409 : 400, body: { error: message } };
}
function actor(value) {
    return typeof value === "string" && value.trim() ? value.trim() : process.env.USER || process.env.USERNAME || "dashboard";
}
function permissionError(projectDir, user, permission, target) {
    if (checkPermission(getUserRoleWithAuth(projectDir, user), permission, projectDir))
        return null;
    addAuditEntry(projectDir, user, "access.denied", target, "denied", `Missing permission ${permission}`);
    return { status: 403, body: { error: `Permission denied: ${permission}` } };
}
export function handleListAcceptance(projectDir, requirementId) {
    try {
        const repo = createRepository(projectDir);
        if (!repo.isInitialized())
            return { status: 503, body: { error: "SDD not initialized" } };
        const service = new AcceptanceService(repo.loadGraph(), loadSddConfig(projectDir).acceptance.legacy_fallback);
        return { status: 200, body: requirementId ? { requirement_id: requirementId, criteria: service.list(requirementId), summary: service.summary(requirementId) } : { criteria: service.list() } };
    }
    catch (e) {
        return error(e);
    }
}
export function handleAcceptanceMutation(projectDir, criterionId, action, raw) {
    const parsed = mutationSchema.extend({ text: z.string().min(1).max(10000).optional() }).safeParse(raw ?? {});
    if (!parsed.success)
        return { status: 400, body: { error: "Invalid acceptance payload", issues: parsed.error.issues } };
    try {
        const repo = createRepository(projectDir);
        if (!repo.isInitialized())
            return { status: 503, body: { error: "SDD not initialized" } };
        const graph = repo.loadGraph();
        const service = new AcceptanceService(graph, loadSddConfig(projectDir).acceptance.legacy_fallback);
        const currentActor = actor(parsed.data.actor);
        const requiredPermission = action === "accept" ? "accept_requirement" : action === "reject" ? "reject_requirement" : action === "waive" ? "waive_requirement" : action === "reopen" ? "reopen_requirement" : "create_requirement";
        const denied = permissionError(projectDir, currentActor, requiredPermission, criterionId);
        if (denied)
            return denied;
        if (action === "update_text") {
            if (!parsed.data.text)
                return { status: 400, body: { error: "text is required" } };
            const criterion = updateAcceptanceCriterionText(graph, criterionId, parsed.data.text, { actor: currentActor, observation: parsed.data.observation });
            repo.saveGraph(graph);
            addAuditEntry(projectDir, currentActor, "acceptance.update_text", criterionId, "allowed", parsed.data.observation);
            return { status: 200, body: { criterion } };
        }
        const input = { actor: currentActor, observation: parsed.data.observation, evidence: parsed.data.evidence, expected_version: parsed.data.expected_version, expected_hash: parsed.data.expected_hash };
        const result = action === "accept" ? service.accept(criterionId, input) : action === "reject" ? service.reject(criterionId, input) : action === "waive" ? service.waive(criterionId, input) : service.reopen(criterionId, input);
        repo.saveGraph(graph);
        addAuditEntry(projectDir, currentActor, `acceptance.${result.audit.action}`, criterionId, "allowed", JSON.stringify(result.audit));
        return { status: 200, body: result };
    }
    catch (e) {
        return error(e);
    }
}
export function handleAcceptAll(projectDir, requirementId, raw) {
    const parsed = mutationSchema.safeParse(raw ?? {});
    if (!parsed.success)
        return { status: 400, body: { error: "Invalid acceptance payload", issues: parsed.error.issues } };
    try {
        const repo = createRepository(projectDir);
        if (!repo.isInitialized())
            return { status: 503, body: { error: "SDD not initialized" } };
        const graph = repo.loadGraph();
        const service = new AcceptanceService(graph, loadSddConfig(projectDir).acceptance.legacy_fallback);
        const currentActor = actor(parsed.data.actor);
        const denied = permissionError(projectDir, currentActor, "accept_requirement", requirementId);
        if (denied)
            return denied;
        const result = service.acceptAll(requirementId, { actor: currentActor, observation: parsed.data.observation, evidence: parsed.data.evidence });
        repo.saveGraph(graph);
        for (const event of result.audit)
            addAuditEntry(projectDir, currentActor, "acceptance.accept", event.criterion_id, "allowed", JSON.stringify(event));
        return { status: result.failed.length > 0 ? 409 : 200, body: result };
    }
    catch (e) {
        return error(e);
    }
}
export function handleAcceptanceMigration(projectDir) {
    try {
        const repo = createRepository(projectDir);
        if (!repo.isInitialized())
            return { status: 503, body: { error: "SDD not initialized" } };
        const graph = repo.loadGraph();
        const result = materializeLegacyAcceptanceCriteria(graph);
        repo.saveGraph(graph);
        addAuditEntry(projectDir, actor(undefined), "acceptance.migrate", "knowledge-graph", "allowed", JSON.stringify(result));
        return { status: 200, body: result };
    }
    catch (e) {
        return error(e);
    }
}
export function handleListGuidance(projectDir, targetNodeId) {
    try {
        const repo = createRepository(projectDir);
        if (!repo.isInitialized())
            return { status: 503, body: { error: "SDD not initialized" } };
        const graph = repo.loadGraph();
        const guidance = graph.nodes.filter((node) => node.type === "guidance" && (!targetNodeId || node.metadata.target_node_id === targetNodeId));
        return { status: 200, body: { guidance } };
    }
    catch (e) {
        return error(e);
    }
}
export function handleImpact(projectDir, nodeId, depth) {
    try {
        const repo = createRepository(projectDir);
        if (!repo.isInitialized())
            return { status: 503, body: { error: "SDD not initialized" } };
        return { status: 200, body: analyzeNodeImpact(repo.loadGraph(), nodeId, depth) };
    }
    catch (e) {
        return error(e);
    }
}
export function handleGuidance(projectDir, action, targetId, raw) {
    const parsed = guidanceSchema.safeParse(raw ?? {});
    if (!parsed.success)
        return { status: 400, body: { error: "Invalid guidance payload", issues: parsed.error.issues } };
    try {
        const repo = createRepository(projectDir);
        if (!repo.isInitialized())
            return { status: 503, body: { error: "SDD not initialized" } };
        const graph = repo.loadGraph();
        const currentActor = actor(parsed.data.actor);
        const denied = permissionError(projectDir, currentActor, "guide_node", targetId);
        if (denied)
            return denied;
        if (action === "create") {
            if (!parsed.data.instruction)
                return { status: 400, body: { error: "instruction is required" } };
            const guidance = createGuidance(graph, targetId, { instruction: parsed.data.instruction, requested_by: currentActor, priority: parsed.data.priority, scope: parsed.data.scope });
            repo.saveGraph(graph);
            addAuditEntry(projectDir, currentActor, "guidance.create", guidance.id, "allowed", parsed.data.instruction);
            return { status: 201, body: { guidance } };
        }
        if (action === "analyze") {
            const result = analyzeGuidance(graph, targetId);
            repo.saveGraph(graph);
            return { status: 200, body: result };
        }
        if (action === "propose") {
            if (!parsed.data.proposal)
                return { status: 400, body: { error: "proposal is required" } };
            const guidance = proposeGuidancePatch(graph, targetId, parsed.data.proposal);
            repo.saveGraph(graph);
            addAuditEntry(projectDir, currentActor, "guidance.propose", targetId, "allowed", JSON.stringify(parsed.data.proposal));
            return { status: 200, body: { guidance } };
        }
        if (action === "apply") {
            const applyDenied = permissionError(projectDir, currentActor, "apply_node_guidance", targetId);
            if (applyDenied)
                return applyDenied;
            if (!parsed.data.proposal)
                return { status: 400, body: { error: "proposal is required" } };
            const result = applyGuidancePatch(graph, targetId, parsed.data.proposal, currentActor, parsed.data.expected_target_version);
            repo.saveGraph(graph);
            addAuditEntry(projectDir, currentActor, "guidance.apply", result.target.id, "allowed", JSON.stringify(parsed.data.proposal));
            return { status: 200, body: result };
        }
        const guidance = rejectGuidance(graph, targetId, currentActor, parsed.data.resolution || "Rejected by user");
        repo.saveGraph(graph);
        addAuditEntry(projectDir, currentActor, "guidance.reject", guidance.id, "allowed", guidance.metadata.resolution);
        return { status: 200, body: { guidance } };
    }
    catch (e) {
        return error(e);
    }
}
