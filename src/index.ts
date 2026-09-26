import type * as V2 from "@opencode/plugin"

/** The V2 plugin contract: `{ id, setup }`. */
type V2Plugin = V2.Plugin.Plugin
import { registerSddV2 } from "./opencode/v2/hooks.js"
import { releaseRuntimeResources } from "./opencode/sdd-runtime.js"
import { resolveProjectDir } from "./sdd/project-dir.js"
import { registerDashboardAgentClient } from "./server/dashboard-context.js"
import { sddDebug } from "./sdd/log.js"

const PLUGIN_ID = "opencode-telos"

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
 * Plugin entrypoint.
 *
 * The V2 shape is written as an object literal rather than
 * `Plugin.define({ ... })` so the published package keeps no runtime import of
 * `@opencode/plugin` — that keeps `scripts/check-import-isolated.cjs` green
 * (production installs exclude peer dependencies). `Plugin.define` is an
 * identity function, and the `satisfies` clause below fails the build if the
 * V2 contract ever diverges from this literal.
 */
const TelosPlugin = {
  id: PLUGIN_ID,
  setup: setupV2,
} satisfies V2Plugin

export default TelosPlugin
