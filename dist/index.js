import { createSddTools } from "./opencode/tools.js";
import { createSddHooks } from "./opencode/hooks.js";
import { resolveProjectDir } from "./sdd/project-dir.js";
import { sddDebug } from "./sdd/log.js";
const SddPlugin = async (_ctx) => {
    // Resolve the project directory using the OpenCode SDK API (most reliable)
    // and fall back to context fields.
    let projectDir;
    try {
        const pathResp = await _ctx.client.path.get();
        const pathData = pathResp.data || pathResp;
        if (pathData?.directory && pathData.directory !== "/") {
            projectDir = pathData.directory;
            sddDebug("plugin", `Resolved project dir via client.path.get(): ${projectDir}`);
        }
        if (!projectDir && pathData?.worktree && pathData.worktree !== "/") {
            projectDir = pathData.worktree;
            sddDebug("plugin", `Resolved project dir via client.path.get() worktree: ${projectDir}`);
        }
    }
    catch (err) {
        sddDebug("plugin", `client.path.get() failed: ${err}`);
    }
    // Fallback to resolveProjectDir with context fields
    if (!projectDir || projectDir === "/") {
        projectDir = resolveProjectDir(_ctx.directory, _ctx.worktree);
        sddDebug("plugin", `Resolved project dir via fallback: ${projectDir}`);
    }
    // Ensure core plugins see the same resolved directory.
    // The intent is that tools, hooks, and state all operate on one project root
    // so that .sdd/ and toggle state live inside the project.
    const ctxWithProjectDir = _ctx;
    ctxWithProjectDir.projectDir = projectDir;
    const hooks = createSddHooks(projectDir);
    const tools = createSddTools();
    return {
        tool: tools,
        ...hooks,
    };
};
export default {
    id: "opencode-telos",
    server: SddPlugin,
};
export { createMcpServer } from "./mcp/server.js";
export { SddDashboardServer } from "./server/server.js";
export { analyzeCodebase } from "./code-intelligence/analyzer.js";
