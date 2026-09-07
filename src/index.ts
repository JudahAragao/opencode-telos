import type { Plugin } from "@opencode-ai/plugin"
import { createSddTools } from "./opencode/tools.js"
import { createSddHooks } from "./opencode/hooks.js"
import { resolveProjectDir } from "./sdd/project-dir.js"

const SddPlugin: Plugin = async (_ctx) => {
  const tools = createSddTools()
  // OpenCode can load npm plugins while its process cwd is unrelated to the
  // active workspace. Always bind hook state to the project directory supplied
  // by the plugin runtime so .sdd stays inside the project.
  const projectDir = resolveProjectDir(_ctx.directory, _ctx.worktree)
  const hooks = createSddHooks(projectDir)

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
