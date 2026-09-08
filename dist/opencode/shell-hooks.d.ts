export interface ShellHookConfig {
    projectDir: string;
    hooks: string[];
}
export declare function generateShellHooks(config: ShellHookConfig): string[];
export declare function formatShellHookResult(created: string[]): string;
