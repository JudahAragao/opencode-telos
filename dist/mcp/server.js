import { createRepository } from "../sdd/persistence/repository.js";
import { calculateQualityScore, formatQualityReport } from "../sdd/quality/scorer.js";
import { detectDrift, formatDriftReport } from "../sdd/drift/detector.js";
import { validateGraph, formatValidationResult } from "../sdd/validation/validator.js";
import { generateHandoff, formatHandoffPack } from "../sdd/session/handoff.js";
import { buildReleaseReport, formatReleaseReport } from "../sdd/release/milestone.js";
import { PLUGIN_VERSION } from "../version.js";
import { AcceptanceService, materializeLegacyAcceptanceCriteria } from "../sdd/acceptance/service.js";
import { createAcceptanceAuditSink } from "../sdd/acceptance/audit.js";
import { applyGuidancePatch, createGuidance } from "../sdd/guidance/service.js";
import { analyzeNodeImpact } from "../sdd/impact/service.js";
import { addAuditEntry, checkPermission, getUserRoleWithAuth } from "../sdd/permissions/access.js";
import { transitionFinalAcceptance } from "../sdd/acceptance/final.js";
export function createMcpServer(projectDir) {
    const config = {
        name: "opencode-telos",
        version: PLUGIN_VERSION,
        description: "OpenCode Telos MCP Server",
    };
    return {
        config,
        getTools() {
            return [
                {
                    name: "sdd_get_quality",
                    description: "Get current SDD quality score",
                    inputSchema: { type: "object", properties: {} },
                },
                {
                    name: "sdd_get_drift",
                    description: "Detect specification drift",
                    inputSchema: { type: "object", properties: {} },
                },
                {
                    name: "sdd_get_validation",
                    description: "Validate SDD graph",
                    inputSchema: { type: "object", properties: {} },
                },
                {
                    name: "sdd_get_handoff",
                    description: "Get session handoff pack",
                    inputSchema: { type: "object", properties: {} },
                },
                {
                    name: "sdd_get_release",
                    description: "Get traceability report per release milestone",
                    inputSchema: { type: "object", properties: {} },
                },
                {
                    name: "sdd_get_acceptance",
                    description: "List acceptance criteria and status for a requirement",
                    inputSchema: { type: "object", properties: { requirement_id: { type: "string" } }, required: ["requirement_id"] },
                },
                {
                    name: "sdd_accept_criterion",
                    description: "Accept one acceptance criterion through the central service",
                    inputSchema: { type: "object", properties: { criterion_id: { type: "string" }, actor: { type: "string" }, observation: { type: "string" } }, required: ["criterion_id"] },
                },
                {
                    name: "sdd_reject_criterion",
                    description: "Reject one acceptance criterion through the central service",
                    inputSchema: { type: "object", properties: { criterion_id: { type: "string" }, actor: { type: "string" }, observation: { type: "string" } }, required: ["criterion_id"] },
                },
                {
                    name: "sdd_waive_criterion",
                    description: "Waive one acceptance criterion with an auditable reason",
                    inputSchema: { type: "object", properties: { criterion_id: { type: "string" }, actor: { type: "string" }, observation: { type: "string" } }, required: ["criterion_id", "observation"] },
                },
                {
                    name: "sdd_reopen_criterion",
                    description: "Reopen one acceptance criterion",
                    inputSchema: { type: "object", properties: { criterion_id: { type: "string" }, actor: { type: "string" }, observation: { type: "string" } }, required: ["criterion_id"] },
                },
                {
                    name: "sdd_accept_all",
                    description: "Accept all pending criteria for a requirement atomically",
                    inputSchema: { type: "object", properties: { requirement_id: { type: "string" }, actor: { type: "string" }, observation: { type: "string" } }, required: ["requirement_id"] },
                },
                {
                    name: "sdd_create_criterion",
                    description: "Create and link an acceptance criterion to a requirement",
                    inputSchema: { type: "object", properties: { requirement_id: { type: "string" }, text: { type: "string" }, actor: { type: "string" } }, required: ["requirement_id", "text"] },
                },
                {
                    name: "sdd_update_criterion",
                    description: "Update criterion text, incrementing its version and invalidating acceptance",
                    inputSchema: { type: "object", properties: { criterion_id: { type: "string" }, text: { type: "string" }, actor: { type: "string" }, observation: { type: "string" } }, required: ["criterion_id", "text"] },
                },
                {
                    name: "sdd_migrate_acceptance",
                    description: "Materialize legacy acceptance metadata into graph nodes",
                    inputSchema: { type: "object", properties: { actor: { type: "string" } } },
                },
                {
                    name: "sdd_node_impact",
                    description: "Analyze the bidirectional impact of any Knowledge Graph node",
                    inputSchema: { type: "object", properties: { node_id: { type: "string" }, depth: { type: "number" } }, required: ["node_id"] },
                },
                {
                    name: "sdd_create_guidance",
                    description: "Record human guidance for any Knowledge Graph node",
                    inputSchema: { type: "object", properties: { node_id: { type: "string" }, instruction: { type: "string" }, actor: { type: "string" } }, required: ["node_id", "instruction"] },
                },
                {
                    name: "sdd_apply_guidance",
                    description: "Apply a validated guidance proposal to any Knowledge Graph node",
                    inputSchema: { type: "object", properties: { guidance_id: { type: "string" }, proposal: { type: "object" }, actor: { type: "string" }, expected_target_version: { type: "number" } }, required: ["guidance_id", "proposal"] },
                },
                {
                    name: "sdd_accept_final",
                    description: "Record final human acceptance for a Change",
                    inputSchema: { type: "object", properties: { change_id: { type: "string" }, actor: { type: "string" }, observation: { type: "string" }, evidence: { type: "array" } }, required: ["change_id"] },
                },
                {
                    name: "sdd_reject_final",
                    description: "Reject final human acceptance for a Change",
                    inputSchema: { type: "object", properties: { change_id: { type: "string" }, actor: { type: "string" }, observation: { type: "string" }, evidence: { type: "array" } }, required: ["change_id"] },
                },
            ];
        },
        async handleToolCall(toolName, _args) {
            const repo = createRepository(projectDir);
            if (!repo.isInitialized()) {
                return { error: "SDD not initialized" };
            }
            const graph = repo.loadGraph();
            try {
                switch (toolName) {
                    case "sdd_get_quality": {
                        const report = calculateQualityScore(graph, projectDir);
                        return { content: [{ type: "text", text: formatQualityReport(report) }] };
                    }
                    case "sdd_get_drift": {
                        const drift = detectDrift(graph, projectDir);
                        return { content: [{ type: "text", text: formatDriftReport(drift) }] };
                    }
                    case "sdd_get_validation": {
                        const result = validateGraph(graph, undefined, projectDir);
                        return { content: [{ type: "text", text: formatValidationResult(result) }] };
                    }
                    case "sdd_get_handoff": {
                        const handoff = generateHandoff(graph, projectDir);
                        return { content: [{ type: "text", text: formatHandoffPack(handoff) }] };
                    }
                    case "sdd_get_release": {
                        const nameOf = (id) => graph.nodes.find((n) => n.id === id)?.name ?? id;
                        const report = buildReleaseReport(graph);
                        return { content: [{ type: "text", text: formatReleaseReport(report, nameOf) }] };
                    }
                    case "sdd_get_acceptance": {
                        const requirementId = String(_args.requirement_id || "");
                        const service = new AcceptanceService(graph, true, createAcceptanceAuditSink(projectDir));
                        return { content: [{ type: "text", text: JSON.stringify({ criteria: service.list(requirementId), summary: service.summary(requirementId) }, null, 2) }] };
                    }
                    case "sdd_accept_criterion": {
                        const criterionId = String(_args.criterion_id || "");
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), "accept_requirement", projectDir))
                            return { error: "Permission denied: accept_requirement" };
                        const service = new AcceptanceService(graph, true, createAcceptanceAuditSink(projectDir));
                        const result = service.accept(criterionId, { actor, observation: typeof _args.observation === "string" ? _args.observation : undefined });
                        repo.saveGraph(graph);
                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    }
                    case "sdd_reject_criterion":
                    case "sdd_waive_criterion":
                    case "sdd_reopen_criterion": {
                        const criterionId = String(_args.criterion_id || "");
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        const permission = toolName === "sdd_reject_criterion" ? "reject_requirement" : toolName === "sdd_waive_criterion" ? "waive_requirement" : "reopen_requirement";
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), permission, projectDir))
                            return { error: `Permission denied: ${permission}` };
                        const service = new AcceptanceService(graph, true, createAcceptanceAuditSink(projectDir));
                        const result = toolName === "sdd_reject_criterion"
                            ? service.reject(criterionId, { actor, observation: typeof _args.observation === "string" ? _args.observation : undefined })
                            : toolName === "sdd_waive_criterion"
                                ? service.waive(criterionId, { actor, observation: typeof _args.observation === "string" ? _args.observation : undefined })
                                : service.reopen(criterionId, { actor, observation: typeof _args.observation === "string" ? _args.observation : undefined });
                        repo.saveGraph(graph);
                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    }
                    case "sdd_accept_all": {
                        const requirementId = String(_args.requirement_id || "");
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), "accept_requirement", projectDir))
                            return { error: "Permission denied: accept_requirement" };
                        const service = new AcceptanceService(graph, true, createAcceptanceAuditSink(projectDir));
                        const result = service.acceptAll(requirementId, { actor, observation: typeof _args.observation === "string" ? _args.observation : undefined });
                        if (result.failed.length > 0)
                            return { error: JSON.stringify(result) };
                        repo.saveGraph(graph);
                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    }
                    case "sdd_create_criterion": {
                        const requirementId = String(_args.requirement_id || "");
                        const text = String(_args.text || "");
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), "create_requirement", projectDir))
                            return { error: "Permission denied: create_requirement" };
                        const service = new AcceptanceService(graph, true, createAcceptanceAuditSink(projectDir));
                        const criterion = service.create(requirementId, text, undefined, actor);
                        repo.saveGraph(graph);
                        return { content: [{ type: "text", text: JSON.stringify(criterion, null, 2) }] };
                    }
                    case "sdd_update_criterion": {
                        const criterionId = String(_args.criterion_id || "");
                        const text = String(_args.text || "");
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), "create_requirement", projectDir))
                            return { error: "Permission denied: create_requirement" };
                        const service = new AcceptanceService(graph, true, createAcceptanceAuditSink(projectDir));
                        const result = service.updateText(criterionId, text, { actor, observation: typeof _args.observation === "string" ? _args.observation : undefined });
                        repo.saveGraph(graph);
                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    }
                    case "sdd_migrate_acceptance": {
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), "create_requirement", projectDir))
                            return { error: "Permission denied: create_requirement" };
                        const result = materializeLegacyAcceptanceCriteria(graph, { removeLegacy: true });
                        repo.saveGraph(graph);
                        addAuditEntry(projectDir, actor, "acceptance.migrate", "knowledge-graph", "allowed", JSON.stringify(result));
                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    }
                    case "sdd_node_impact": {
                        const result = analyzeNodeImpact(graph, String(_args.node_id || ""), typeof _args.depth === "number" ? _args.depth : 5);
                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    }
                    case "sdd_create_guidance": {
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), "guide_node", projectDir))
                            return { error: "Permission denied: guide_node" };
                        const guidance = createGuidance(graph, String(_args.node_id || ""), { instruction: String(_args.instruction || ""), requested_by: actor });
                        repo.saveGraph(graph);
                        addAuditEntry(projectDir, actor, "guidance.create", guidance.id, "allowed", guidance.metadata.instruction);
                        return { content: [{ type: "text", text: JSON.stringify(guidance, null, 2) }] };
                    }
                    case "sdd_apply_guidance": {
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), "apply_node_guidance", projectDir))
                            return { error: "Permission denied: apply_node_guidance" };
                        const proposal = (_args.proposal && typeof _args.proposal === "object" ? _args.proposal : {});
                        const result = applyGuidancePatch(graph, String(_args.guidance_id || ""), proposal, actor, typeof _args.expected_target_version === "number" ? _args.expected_target_version : undefined);
                        repo.saveGraph(graph);
                        addAuditEntry(projectDir, actor, "guidance.apply", result.target.id, "allowed", JSON.stringify(proposal));
                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    }
                    case "sdd_accept_final":
                    case "sdd_reject_final": {
                        const changeId = String(_args.change_id || "");
                        const actor = String(_args.actor || process.env.USER || "mcp");
                        const permission = toolName === "sdd_accept_final" ? "accept_final" : "reject_final";
                        if (!checkPermission(getUserRoleWithAuth(projectDir, actor), permission, projectDir))
                            return { error: `Permission denied: ${permission}` };
                        const result = transitionFinalAcceptance(graph, changeId, toolName === "sdd_accept_final" ? "ACCEPTED" : "REJECTED", {
                            actor,
                            observation: typeof _args.observation === "string" ? _args.observation : undefined,
                            evidence: Array.isArray(_args.evidence) ? _args.evidence : undefined,
                        });
                        repo.saveGraph(graph);
                        addAuditEntry(projectDir, actor, `acceptance.${toolName === "sdd_accept_final" ? "final_accept" : "final_reject"}`, changeId, "allowed", JSON.stringify(result));
                        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
                    }
                    default:
                        return { error: `Unknown tool: ${toolName}` };
                }
            }
            catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
            }
        },
    };
}
