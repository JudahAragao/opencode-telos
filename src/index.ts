import type { Plugin } from "@opencode-ai/plugin"
import { createSddTools } from "./opencode/tools.js"
import { createSddHooks } from "./opencode/hooks.js"

const SddPlugin: Plugin = async (_ctx) => {
  const tools = createSddTools()
  const hooks = createSddHooks()

  return {
    tool: tools,
    ...hooks,
  }
}

export default {
  id: "opencode-telos",
  server: SddPlugin,
}

export { createMcpServer } from "./mcp/server.js"
export { SddDashboardServer } from "./server/server.js"
export { analyzeCodebase } from "./code-intelligence/analyzer.js"
