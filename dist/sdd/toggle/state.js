import { readFileSync, existsSync, mkdirSync } from "fs";
import { atomicWriteFile } from "../cache/atomic.js";
import { join, dirname, resolve, sep } from "path";
import { sddDebug } from "../log.js";
const TOGGLE_FILE = ".sdd/enabled";
function assertNotRoot(projectDir, action) {
    const resolved = resolve(projectDir);
    if (resolved === sep) {
        sddDebug("toggle", `Refusing to ${action} in filesystem root (${projectDir}). This usually means the plugin received directory="/" from OpenCode.`);
        throw new Error(`[SDD] Cannot ${action} — project directory resolves to filesystem root (${projectDir}).\n` +
            `The plugin likely received an incorrect directory from the OpenCode runtime.\n` +
            `Please verify your opencode configuration and ensure the plugin is loaded in the correct project context.`);
    }
}
export function getToggleState(projectDir) {
    assertNotRoot(projectDir, "read toggle state");
    const filePath = join(projectDir, TOGGLE_FILE);
    if (!existsSync(filePath)) {
        return { enabled: true, changed_at: new Date().toISOString() };
    }
    try {
        const content = readFileSync(filePath, "utf-8").trim();
        return JSON.parse(content);
    }
    catch {
        return { enabled: true, changed_at: new Date().toISOString() };
    }
}
export function setToggleState(projectDir, enabled) {
    assertNotRoot(projectDir, "set toggle state");
    const state = {
        enabled,
        changed_at: new Date().toISOString(),
    };
    const filePath = join(projectDir, TOGGLE_FILE);
    const dir = dirname(filePath);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    atomicWriteFile(filePath, JSON.stringify(state, null, 2));
    return state;
}
export function isSddEnabled(projectDir) {
    return getToggleState(projectDir).enabled;
}
