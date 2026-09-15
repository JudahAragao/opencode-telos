import type { KnowledgeGraph } from "../domain/types.js";
export interface ExecutableCheck {
    name: string;
    command: string[];
    status: "passed" | "failed" | "skipped";
    output: string;
}
/** Hash of one file declared as affected by a Change (G6/G8). */
export interface ScopedFileHash {
    path: string;
    /** null when the declared file did not exist on disk at verification time. */
    sha256: string | null;
}
export interface ExecutableValidationResult {
    passed: boolean;
    verified: boolean;
    checks: ExecutableCheck[];
    created_at: string;
    /** Content fingerprint captured after verification, used to reject stale reports. */
    project_fingerprint: string;
    functional_verified?: boolean;
    functional_gaps?: string[];
    /** Whether the Change has affected requirements at all (G1). */
    functional_applicable?: boolean;
    /** Affected requirement node ids that the evidence was evaluated against (G1). */
    functional_requirements?: string[];
    /** Explicit statement recorded on the Change that no requirement is affected (G1). */
    no_requirement_impact?: boolean;
    /** True when verification was explicitly waived because no script is declared (G4). */
    verification_waived?: boolean;
    waiver_reason?: string;
    /** Per-file hashes of the Change's declared affected files (G6/G8). */
    scoped_files?: ScopedFileHash[];
}
export interface FunctionalEvidenceResult {
    verified: boolean;
    /** False when the Change declares no affected requirement (evidence N/A, not "passing"). */
    applicable: boolean;
    requirements: string[];
    gaps: string[];
}
/**
 * Avalia a evidência funcional do Change (requisito → teste).
 *
 * G1: ausência de requisito afetado NÃO é aprovação. Antes isso retornava
 * `verified: true`, o que anulava a trava sempre que o agente omitisse o escopo.
 * Agora exige uma declaração explícita (`no_requirement_impact`) para o caso
 * legítimo de mudança que não altera comportamento especificado.
 */
export declare function validateFunctionalEvidence(graph: KnowledgeGraph, changeId: string): FunctionalEvidenceResult;
/**
 * Hash source and manifest contents without including generated SDD reports or
 * dependency trees. This makes a verification report invalid after code or
 * configuration changes, while keeping completion checks reasonably cheap.
 */
export declare function computeProjectFingerprint(projectDir: string): string;
export interface ExecutableValidationOptions {
    /**
     * G4: permite registrar uma dispensa explícita e auditável quando o projeto
     * não declara nenhum script de verificação. Sem isso, o fluxo trava em
     * `verified: false` e a única saída seria `force=true` (não auditável).
     */
    acknowledgeNoScripts?: boolean;
    waiverReason?: string;
}
/** Run only project-declared verification scripts; never invent a package manager command. */
export declare function validateExecutableProject(projectDir: string, options?: ExecutableValidationOptions): ExecutableValidationResult;
/**
 * Hash dos arquivos declarados como afetados pelo Change (G6/G8).
 * `sha256: null` registra que o arquivo declarado não existia na verificação.
 */
export declare function computeScopedFileHashes(projectDir: string, files: readonly string[]): ScopedFileHash[];
/**
 * Confere se os arquivos declarados pelo Change são exatamente os que foram
 * verificados (G8) e se nada mudou neles desde então (G6).
 */
export declare function verifyScopedFiles(projectDir: string, result: ExecutableValidationResult): {
    ok: boolean;
    gaps: string[];
};
export declare function isExecutableValidationCurrent(projectDir: string, result: ExecutableValidationResult): boolean;
export declare function saveExecutableValidation(projectDir: string, changeId: string, result: ExecutableValidationResult): void;
export declare function loadExecutableValidation(projectDir: string, changeId: string): ExecutableValidationResult | undefined;
