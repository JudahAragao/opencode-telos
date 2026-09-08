/** Resolve a user-provided path without allowing traversal or symlink escape. */
export declare function projectPath(projectDir: string, userPath: string, forWrite?: boolean): string;
export declare function assertProjectPath(projectDir: string, userPath: string): void;
