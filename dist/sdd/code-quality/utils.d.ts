/**
 * Check if a file matches the focusFiles patterns.
 * Supports * wildcard (e.g., "src/services/*", "*Service*").
 */
export declare function fileMatchesFocus(fileName: string, focusFiles: string[]): boolean;
