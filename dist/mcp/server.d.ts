export interface McpServerConfig {
    name: string;
    version: string;
    description: string;
}
export declare function createMcpServer(projectDir: string): {
    config: McpServerConfig;
    getTools(): {
        name: string;
        description: string;
        inputSchema: {
            type: "object";
            properties: {};
        };
    }[];
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
