import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { createSddTools } from "./opencode/tools.js"
import { createSddHooks } from "./opencode/hooks.js"
import { resolveProjectDir } from "./sdd/project-dir.js"
import { sddDebug } from "./sdd/log.js"

const SddPlugin: Plugin = async (_ctx) => {
  // Plugin init runs before the HTTP server is ready, so we must NOT await any
  // client.* call here (it never resolves and hangs startup).
  // resolveProjectDir resolves ctx.directory -> ctx.worktree -> process.cwd(),
  // rejecting "/" which is what global installs pass for directory.
  const projectDir = resolveProjectDir(_ctx.directory, _ctx.worktree)
  sddDebug("plugin", `Resolved project dir: ${projectDir}`)

  // Ensure core plugins see the same resolved directory.
  // The intent is that tools, hooks, and state all operate on one project root
  // so that .sdd/ and toggle state live inside the project.
  const ctxWithProjectDir: any = _ctx
  ctxWithProjectDir.projectDir = projectDir

  const hooks = createSddHooks(projectDir)
  const tools = createSddTools()

  return {
    tool: tools,
    ...hooks,
  }
}

export default {
  id: "opencode-telos",
  server: SddPlugin,
} satisfies PluginModule
