import type { KnowledgeGraph } from "../domain/types.js";
export declare function stableSerialize(value: unknown): string;
export declare function sha256(value: string | Uint8Array): string;
/** Deterministic content fingerprint for the complete graph, independent of YAML/SQLite formatting. */
export declare function graphFingerprint(graph: KnowledgeGraph): string;
export declare function fileContentFingerprint(filePath: string): string;
/** Cryptographic content identity for external-file detection. */
export declare function fileSignature(filePaths: string[]): string;
export declare function configFingerprint(projectDir: string): string;
/**
 * Content fingerprint for code-dependent analyses.
 *
 * File stat metadata is not trusted as proof of unchanged content: editors,
 * overlays and fast successive writes can preserve size and timestamps.
 */
export declare function sourceFingerprint(projectDir: string, previous?: {
    fingerprint: string;
    signature: string;
} | null): {
    fingerprint: string;
    signature: string;
};
