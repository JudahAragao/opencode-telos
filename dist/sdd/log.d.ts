/**
 * Lightweight debug logger for the SDD system.
 *
 * Enable by setting SDD_DEBUG=1 or SDD_DEBUG=true in the environment.
 * All output goes to stderr so it never contaminates tool output.
 */
export declare function sddDebug(component: string, message: string, details?: unknown): void;
export declare function sddWarn(component: string, message: string, details?: unknown): void;
export declare function sddError(component: string, message: string, error?: unknown): void;
