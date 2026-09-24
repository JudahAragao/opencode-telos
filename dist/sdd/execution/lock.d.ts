/** Serialize mutations per project without coupling unrelated projects. */
export declare function withProjectExecutionLock<T>(projectDir: string, operation: () => Promise<T> | T): Promise<T>;
