export interface ProjectConventions {
    naming: {
        variables: "camelCase" | "snake_case" | "PascalCase" | "unknown";
        functions: "camelCase" | "snake_case" | "PascalCase" | "unknown";
        files: "camelCase" | "snake_case" | "PascalCase" | "kebab-case" | "unknown";
        constants: "camelCase" | "UPPER_SNAKE_CASE" | "unknown";
    };
    imports: {
        style: "relative" | "absolute" | "mixed";
        useBarrelFiles: boolean;
        extension: "always" | "never" | "ts-only" | "unknown";
    };
    async: {
        style: "async-await" | "promises" | "callbacks" | "mixed";
        errorHandling: "try-catch" | "Result" | "error-first-cb" | "mixed";
    };
    structure: {
        organization: "domain" | "feature" | "layer" | "flat" | "unknown";
        hasIndexFiles: boolean;
        testLocation: "co-located" | "separate" | "mixed";
    };
    metadata: Record<string, unknown>;
}
/**
 * Analyze a project directory to detect coding conventions.
 * Samples up to 20 files for performance.
 */
export declare function detectConventions(projectDir: string): ProjectConventions;
/**
 * Format conventions as a readable report.
 */
export declare function formatConventions(c: ProjectConventions): string;
