import { createRepository } from "../sdd/persistence/repository.js";
import { calculateQualityScore, formatQualityReport } from "../sdd/quality/scorer.js";
import { detectDrift, formatDriftReport } from "../sdd/drift/detector.js";
import { validateGraph, formatValidationResult } from "../sdd/validation/validator.js";
import { generateHandoff, formatHandoffPack } from "../sdd/session/handoff.js";
export function createMcpServer(projectDir) {
    const config = {
        name: "opencode-telos",
        version: "1.1.7",
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
            ];
        },
        async handleToolCall(toolName, _args) {
            const repo = createRepository(projectDir);
            if (!repo.isInitialized()) {
                return { error: "SDD not initialized" };
            }
            const graph = repo.loadGraph();
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
                default:
                    return { error: `Unknown tool: ${toolName}` };
            }
        },
    };
}
