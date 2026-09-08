import type { Plugin } from "@opencode-ai/plugin";
declare const _default: {
    id: string;
    server: Plugin;
};
export default _default;
export { createMcpServer } from "./mcp/server.js";
export { SddDashboardServer } from "./server/server.js";
export { analyzeCodebase } from "./code-intelligence/analyzer.js";
