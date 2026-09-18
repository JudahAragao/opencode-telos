import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { createSddTools } from "./opencode/tools.js"
import { createSddHooks } from "./opencode/hooks.js"
import { createSddCommandHooks } from "./opencode/command.js"
import { resolveProjectDir } from "./sdd/project-dir.js"
import { registerDashboardAgentClient } from "./server/dashboard-context.js"
import { sddDebug } from "./sdd/log.js"

const SddPlugin: Plugin = async (_ctx) => {
  // Plugin init runs before the HTTP server is ready, so we must NOT await any
  // client.* call here (it never resolves and hangs startup).
  // resolveProjectDir resolves ctx.directory -> ctx.worktree -> process.cwd(),
  // rejecting "/" which is what global installs pass for directory.
  const projectDir = resolveProjectDir(_ctx.directory, _ctx.worktree)
  sddDebug("plugin", `Resolved project dir: ${projectDir}`)

  // Hand the OpenCode SDK client to the dashboard bridge. This is only a
  // reference assignment (no client.* call), so it is safe during init — the
  // actual prompt happens later, when a Kanban card is saved.
  try {
    registerDashboardAgentClient(_ctx.client)
  } catch (error) {
    sddDebug("plugin", `Failed to register dashboard client: ${String(error)}`)
  }

  // Ensure core plugins see the same resolved directory.
  // The intent is that tools, hooks, and state all operate on one project root
  // so that .sdd/ and toggle state live inside the project.
  const ctxWithProjectDir: any = _ctx
  ctxWithProjectDir.projectDir = projectDir

  const hooks = createSddHooks(projectDir)
  const commandHooks = createSddCommandHooks(projectDir)
  const tools = createSddTools()

  return {
    tool: tools,
    ...hooks,
    ...commandHooks,
  }
}

export default {
  id: "opencode-telos",
  server: SddPlugin,
} satisfies PluginModule
