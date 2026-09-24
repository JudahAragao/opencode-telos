/**
 * Reverse Engineering Scanner — Analisa um codebase existente e gera um
 * BriefingDeepAnalysis agnóstico de tecnologia.
 *
 * O scanner extrai:
 * - Entidades e campos (de models/schemas/migrations)
 * - Endpoints (de routes/controllers)
 * - Regras de negócio (de services/use-cases)
 * - Componentes arquiteturais (por camada genérica)
 * - Decisões arquiteturais (inferidas da estrutura)
 *
 * Quando purpose === "reverse_engineering", TODA a tecnologia específica
 * é removida — o resultado descreve O QUE o sistema faz, não COMO.
 *
 * Consumido por: tools.ts (sdd.reverse_engineer)
 * Dependências: brownfield/scanner.ts, fs, path
 */
import type { BriefingDeepAnalysis } from "../discovery/briefing-analyzer.js";
import { type BrownfieldAnalysis } from "./scanner.js";
import { type FindingInput } from "./findings.js";
export interface ReverseEngineeringOptions {
    purpose: "documentation" | "reverse_engineering";
    depth: "structure" | "full";
    focusDirs?: string[];
    excludeDirs?: string[];
    maxFiles?: number;
}
export interface DiscoveredEntity {
    name: string;
    description: string;
    fields: Array<{
        name: string;
        type: string;
        required?: boolean;
    }>;
    source: string;
    confidence: "high" | "medium" | "low";
}
export interface DiscoveredEndpoint {
    method: string;
    path: string;
    description: string;
    relatedEntity?: string;
    source: string;
    confidence: "high" | "medium" | "low";
}
export interface DiscoveredBusinessRule {
    name: string;
    description: string;
    source: string;
    confidence: "high" | "medium" | "low";
}
export interface DiscoveredArchitecture {
    name: string;
    layer: "frontend" | "backend" | "database" | "infrastructure" | "external";
    technology: string;
    description: string;
    source: string;
}
export interface ReverseEngineeringResult {
    analysis: BriefingDeepAnalysis;
    brownfield: BrownfieldAnalysis;
    findings: FindingInput[];
    discoveredEntities: DiscoveredEntity[];
    discoveredEndpoints: DiscoveredEndpoint[];
    discoveredBusinessRules: DiscoveredBusinessRule[];
    discoveredArchitecture: DiscoveredArchitecture[];
    summary: string;
}
export declare function reverseEngineerProject(projectDir: string, options: ReverseEngineeringOptions): ReverseEngineeringResult;
