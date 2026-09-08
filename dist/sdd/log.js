/**
 * Lightweight debug logger for the SDD system.
 *
 * Enable by setting SDD_DEBUG=1 or SDD_DEBUG=true in the environment.
 * All output goes to stderr so it never contaminates tool output.
 */
const enabled = process.env.SDD_DEBUG === "1" || process.env.SDD_DEBUG === "true";
export function sddDebug(component, message, details) {
    if (!enabled)
        return;
    const suffix = details !== undefined ? ` ${JSON.stringify(details)}` : "";
    process.stderr.write(`[sdd:${component}] ${message}${suffix}\n`);
}
export function sddWarn(component, message, details) {
    const suffix = details !== undefined ? ` ${JSON.stringify(details)}` : "";
    process.stderr.write(`[sdd:${component}] WARNING ${message}${suffix}\n`);
}
export function sddError(component, message, error) {
    const suffix = error instanceof Error ? ` ${error.message}` : error !== undefined ? ` ${String(error)}` : "";
    process.stderr.write(`[sdd:${component}] ERROR ${message}${suffix}\n`);
}
