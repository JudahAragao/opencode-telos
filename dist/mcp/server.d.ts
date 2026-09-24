export interface McpServerConfig {
    name: string;
    version: string;
    description: string;
}
export declare function createMcpServer(projectDir: string): {
    config: McpServerConfig;
    getTools(): ({
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                requirement_id?: undefined;
                criterion_id?: undefined;
                actor?: undefined;
                observation?: undefined;
                text?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required?: undefined;
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                requirement_id: {
                    type: string;
                };
                criterion_id?: undefined;
                actor?: undefined;
                observation?: undefined;
                text?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required: string[];
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                criterion_id: {
                    type: string;
                };
                actor: {
                    type: string;
                };
                observation: {
                    type: string;
                };
                requirement_id?: undefined;
                text?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required: string[];
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                requirement_id: {
                    type: string;
                };
                actor: {
                    type: string;
                };
                observation: {
                    type: string;
                };
                criterion_id?: undefined;
                text?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required: string[];
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                requirement_id: {
                    type: string;
                };
                text: {
                    type: string;
                };
                actor: {
                    type: string;
                };
                criterion_id?: undefined;
                observation?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required: string[];
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                criterion_id: {
                    type: string;
                };
                text: {
                    type: string;
                };
                actor: {
                    type: string;
                };
                observation: {
                    type: string;
                };
                requirement_id?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required: string[];
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                actor: {
                    type: string;
                };
                requirement_id?: undefined;
                criterion_id?: undefined;
                observation?: undefined;
                text?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required?: undefined;
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                node_id: {
                    type: string;
                };
                depth: {
                    type: string;
                };
                requirement_id?: undefined;
                criterion_id?: undefined;
                actor?: undefined;
                observation?: undefined;
                text?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required: string[];
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                node_id: {
                    type: string;
                };
                instruction: {
                    type: string;
                };
                actor: {
                    type: string;
                };
                requirement_id?: undefined;
                criterion_id?: undefined;
                observation?: undefined;
                text?: undefined;
                depth?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required: string[];
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                guidance_id: {
                    type: string;
                };
                proposal: {
                    type: string;
                };
                actor: {
                    type: string;
                };
                expected_target_version: {
                    type: string;
                };
                requirement_id?: undefined;
                criterion_id?: undefined;
                observation?: undefined;
                text?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                change_id?: undefined;
                evidence?: undefined;
            };
            required: string[];
        };
    } | {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {
                change_id: {
                    type: string;
                };
                actor: {
                    type: string;
                };
                observation: {
                    type: string;
                };
                evidence: {
                    type: string;
                };
                requirement_id?: undefined;
                criterion_id?: undefined;
                text?: undefined;
                node_id?: undefined;
                depth?: undefined;
                instruction?: undefined;
                guidance_id?: undefined;
                proposal?: undefined;
                expected_target_version?: undefined;
            };
            required: string[];
        };
    })[];
    handleToolCall(toolName: string, _args: Record<string, unknown>): Promise<{
        error: string;
        content?: undefined;
    } | {
        content: {
            type: string;
            text: string;
        }[];
        error?: undefined;
    }>;
};
