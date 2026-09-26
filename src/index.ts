import type { Plugin as V1Plugin, PluginModule } from "@opencode-ai/plugin"
import type * as V2 from "@opencode/plugin"

/** The V2 plugin contract: `{ id, setup }`. */
type V2Plugin = V2.Plugin.Plugin
import { createSddTools } from "./opencode/tools.js"
import { createSddHooks } from "./opencode/hooks.js"
import { createSddCommandHooks } from "./opencode/command.js"
import { registerSddV2 } from "./opencode/v2/hooks.js"
import { releaseRuntimeResources } from "./opencode/sdd-runtime.js"
import { resolveProjectDir } from "./sdd/project-dir.js"
import { registerDashboardAgentClient, registerDashboardClientV1 } from "./server/dashboard-context.js"
import { sddDebug } from "./sdd/log.js"
import { projectToolNames, safeToolNamesEnabled } from "./opencode/tool-names.js"

const PLUGIN_ID = "opencode-telos"

/**
 * V1 host adapter (OpenCode 1.18 `Plugin`).
 *
 * Kept intact so the plugin keeps working on the 1.x line. The V2 `setup` below
 * runs the exact same rules through `./opencode/v2/`.
 */
const SddPluginV1: V1Plugin = async (_ctx) => {
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
    registerDashboardClientV1(_ctx.client)
  } catch (error) {
    sddDebug("plugin", `Failed to register dashboard client: ${String(error)}`)
  }

  // Ensure core plugins see the same resolved directory.
  // The intent is that tools, hooks, and state all operate on one project root
  // so that .sdd/ and toggle state live inside the project.
  const ctxWithProjectDir = _ctx as unknown as { projectDir: string }
  ctxWithProjectDir.projectDir = projectDir

  const safeToolNames = safeToolNamesEnabled(projectDir)
  const hooks = createSddHooks(projectDir, safeToolNames)
  const commandHooks = createSddCommandHooks(projectDir)

  return {
    // `projectToolNames` renames the keys *and* rewrites dotted references inside
    // each description, and fails loudly on a collision.
    tool: projectToolNames(createSddTools(), safeToolNames),
    ...hooks,
    ...commandHooks,
  }
}

/**
 * V2 host adapter (`@opencode/plugin` 2.x).
 *
 * The V2 context *is* the OpenCode client, so the dashboard bridge receives a
 * prompt submitter rather than a client object.
 */
async function setupV2(ctx: Parameters<V2Plugin["setup"]>[0]): Promise<() => void> {
  const projectDir = resolveProjectDir(ctx.location.directory)
  sddDebug("plugin", `Resolved project dir: ${projectDir}`)

  // Reference only — no request is issued during init.
  try {
    registerDashboardAgentClient((sessionID, text) => ctx.session.prompt({ sessionID, text }))
  } catch (error) {
    sddDebug("plugin", `Failed to register dashboard client: ${String(error)}`)
  }

  const registration = await registerSddV2(ctx as never, projectDir, { debug: true })

  // V2 has no `dispose` hook: the Cleanup returned by `setup` is the documented
  // equivalent. Tool/command transforms and hooks are disposed by the host.
  return () => {
    registration.release()
    releaseRuntimeResources(projectDir)
  }
}

/**
 * Dual entrypoint.
 *
 * A V1 host calls `server()`; a V2 host reads `id` + `setup`. The V2 shape is
 * written as an object literal rather than `Plugin.define({ ... })` so the
 * published package keeps no runtime import of `@opencode/plugin` — that keeps
 * V1-only installations working and `scripts/check-import-isolated.cjs` green.
 * `Plugin.define` is an identity function, and the `satisfies` clause below
 * fails the build if the V2 contract ever diverges from this literal.
 */
const TelosPlugin = {
  id: PLUGIN_ID,
  setup: setupV2,
  server: SddPluginV1,
} satisfies V2Plugin & PluginModule

export default TelosPlugin
