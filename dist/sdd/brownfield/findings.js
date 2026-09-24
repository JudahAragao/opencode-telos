import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { addNode, addRelationship, getNode, updateNode } from "../graph/engine.js";
import { createTask } from "../tasks/board.js";
const CODE_EXTENSIONS = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".java", ".rb", ".rs", ".php", ".cs",
]);
function stableHash(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
export function findingFingerprint(input) {
    return stableHash([
        input.category,
        input.title.trim().toLowerCase(),
        (input.source_files ?? []).slice().sort().join(","),
        input.observed_behavior.trim().toLowerCase(),
    ].join("|"));
}
function findingId(fingerprint) {
    return `FND-${fingerprint}`;
}
function now() {
    return new Date().toISOString();
}
function statusHistory(finding) {
    return Array.isArray(finding.metadata.history) ? finding.metadata.history : [];
}
function sourceNodeForPath(graph, path) {
    return graph.nodes.find((node) => {
        if (node.type !== "file")
            return false;
        const metadata = node.metadata;
        return metadata.path === path || node.name === path;
    });
}
function ensureSourceFile(graph, path) {
    const existing = sourceNodeForPath(graph, path);
    if (existing)
        return existing;
    const id = `${graph.project_id}-FILE-${stableHash(path)}`;
    if (getNode(graph, id))
        return getNode(graph, id);
    const timestamp = now();
    const file = {
        id,
        type: "file",
        name: path,
        description: `Source file observed during brownfield analysis: ${path}`,
        status: "APPROVED",
        version: 1,
        metadata: { path, discovered_by: "brownfield_findings" },
        created_at: timestamp,
        updated_at: timestamp,
    };
    addNode(graph, file);
    try {
        addRelationship(graph, graph.project_id, id, "contains", { source: "brownfield_findings" });
    }
    catch { }
    return file;
}
export function upsertFinding(graph, input) {
    const fingerprint = input.fingerprint ?? findingFingerprint(input);
    const existing = graph.nodes.find((node) => node.type === "finding" && node.metadata.fingerprint === fingerprint);
    const sourceFiles = [...new Set(input.source_files ?? [])];
    const sourceNodeIds = [...new Set(input.source_node_ids ?? [])];
    const evidence = input.evidence ?? [];
    if (existing) {
        const metadata = existing.metadata;
        const mergedEvidence = [...(metadata.evidence ?? []), ...evidence]
            .filter((item, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(item)) === index);
        const mergedFiles = [...new Set([...(metadata.source_files ?? []), ...sourceFiles])];
        const mergedNodes = [...new Set([...(metadata.source_node_ids ?? []), ...sourceNodeIds])];
        updateNode(graph, existing.id, {
            metadata: {
                ...metadata,
                evidence: mergedEvidence,
                source_files: mergedFiles,
                source_node_ids: mergedNodes,
                confidence: Math.max(metadata.confidence ?? 0, input.confidence ?? 0.5),
            },
        });
        return getNode(graph, existing.id);
    }
    const timestamp = now();
    const node = {
        id: findingId(fingerprint),
        type: "finding",
        name: input.title,
        description: input.observed_behavior,
        status: "open",
        version: 1,
        metadata: {
            fingerprint,
            category: input.category,
            severity: input.severity,
            title: input.title,
            observed_behavior: input.observed_behavior,
            expected_behavior: input.expected_behavior,
            purpose: input.purpose,
            confidence: input.confidence ?? 0.5,
            evidence,
            source_files: sourceFiles.slice(0, 50),
            source_node_ids: sourceNodeIds,
            remediation: input.remediation,
            target_behavior: input.target_behavior,
            history: [{ status: "open", at: timestamp, actor: "brownfield_scan" }],
        },
        created_at: timestamp,
        updated_at: timestamp,
    };
    addNode(graph, node);
    for (const path of sourceFiles) {
        const source = ensureSourceFile(graph, path);
        if (source) {
            try {
                addRelationship(graph, node.id, source.id, "detected_in", { source: "brownfield_findings", path });
            }
            catch { }
        }
    }
    for (const sourceId of sourceNodeIds) {
        if (!getNode(graph, sourceId))
            continue;
        try {
            addRelationship(graph, node.id, sourceId, "detected_in", { source: "brownfield_findings" });
        }
        catch { }
    }
    return node;
}
export function createFindingTask(graph, finding, options = { purpose: "documentation" }) {
    const existing = graph.nodes.find((node) => node.type === "task" && node.metadata.finding_id === finding.id);
    if (existing)
        return existing;
    const metadataPriority = finding.metadata.severity;
    const targetName = options.targetNodeId ? getNode(graph, options.targetNodeId)?.name : undefined;
    const task = createTask(graph, {
        name: options.purpose === "documentation"
            ? `Corrigir descoberta: ${finding.name}`
            : `Implementar decisão derivada: ${targetName ?? finding.name}`,
        description: options.purpose === "documentation"
            ? finding.metadata.observed_behavior
            : finding.metadata.target_behavior ?? finding.metadata.observed_behavior,
        goal: options.purpose === "documentation"
            ? finding.metadata.remediation ?? "Corrigir o problema observado e adicionar verificação."
            : finding.metadata.target_behavior ?? "Implementar o comportamento definido no SDD alvo.",
        files: options.purpose === "documentation" ? finding.metadata.source_files : [],
        acceptance: [
            options.purpose === "documentation"
                ? "A causa da descoberta foi corrigida no sistema documentado."
                : "O comportamento alvo está implementado sem reproduzir o problema do sistema de origem.",
            "Existe evidência de verificação registrada no SDD.",
        ],
        priority: metadataPriority,
        status: options.blocked ? "blocked" : "todo",
        link_to: options.targetNodeId ?? finding.id,
        link_type: options.targetNodeId ? "implements" : "resolves",
        origin: options.purpose === "documentation" ? "documentation_finding" : "reverse_engineering_target",
        integration_status: "pending",
    });
    task.metadata.finding_id = finding.id;
    task.metadata.purpose = options.purpose;
    try {
        addRelationship(graph, finding.id, task.id, "tracked_by", { source: "brownfield_findings" });
    }
    catch { }
    return task;
}
export function resolveFinding(graph, input) {
    const node = getNode(graph, input.findingId);
    if (!node || node.type !== "finding")
        throw new Error(`Finding ${input.findingId} not found`);
    const finding = node;
    const timestamp = now();
    const status = input.status ?? "resolved";
    if ((status === "resolved" || status === "closed") && finding.metadata.purpose === "documentation" && !input.changeId && !input.taskId) {
        throw new Error("Documentation findings require a change_id or task_id before they can be marked resolved.");
    }
    if ((status === "resolved" || status === "closed") && finding.metadata.purpose === "reverse_engineering" && !(input.targetNodeIds?.length || input.changeId || input.taskId)) {
        throw new Error("Reverse-engineering findings require target_node_ids, change_id, or task_id before they can be marked resolved.");
    }
    const metadata = finding.metadata;
    const resolutionEvidence = input.evidence ?? [];
    const history = [...statusHistory(finding), {
            status,
            at: timestamp,
            reason: input.description,
            actor: input.actor ?? "sdd.findings",
        }];
    const resolved = updateNode(graph, finding.id, {
        status,
        metadata: {
            ...metadata,
            history,
            resolution: {
                description: input.description,
                change_id: input.changeId,
                task_id: input.taskId,
                evidence: resolutionEvidence,
                resolved_at: timestamp,
            },
        },
    });
    for (const sourceId of [input.changeId, input.taskId, ...(input.targetNodeIds ?? [])].filter(Boolean)) {
        if (!getNode(graph, sourceId))
            continue;
        const source = getNode(graph, sourceId);
        const type = source.type === "change" || source.type === "task" || source.type === "requirement" || source.type === "decision" || source.type === "constraint"
            ? "resolves"
            : "evidenced_by";
        try {
            addRelationship(graph, sourceId, finding.id, type, { source: "finding_resolution", description: input.description });
        }
        catch { }
    }
    return resolved;
}
export function transitionFinding(graph, findingId, status, reason, actor = "sdd.findings") {
    const node = getNode(graph, findingId);
    if (!node || node.type !== "finding")
        throw new Error(`Finding ${findingId} not found`);
    const finding = node;
    const history = [...statusHistory(finding), { status, at: now(), reason, actor }];
    return updateNode(graph, findingId, {
        status,
        metadata: { ...finding.metadata, history },
    });
}
export function getFindings(graph, status) {
    return graph.nodes.filter((node) => node.type === "finding" && (!status || node.status === status));
}
export function formatFindingsReport(graph, purpose) {
    const findings = getFindings(graph).filter((finding) => !purpose || finding.metadata.purpose === purpose);
    const counts = findings.reduce((acc, finding) => {
        acc[finding.status] = (acc[finding.status] ?? 0) + 1;
        return acc;
    }, {});
    const lines = [
        "## Brownfield Findings",
        "",
        `Total: ${findings.length}`,
        `Open: ${counts.open ?? 0} | In progress: ${counts.in_progress ?? 0} | Resolved: ${counts.resolved ?? 0} | Accepted: ${counts.accepted ?? 0}`,
    ];
    for (const finding of findings.sort((a, b) => a.metadata.severity.localeCompare(b.metadata.severity))) {
        lines.push(`- **${finding.id}** [${finding.status}/${finding.metadata.severity}] ${finding.name}`);
        lines.push(`  - ${finding.metadata.observed_behavior}`);
        if (finding.metadata.resolution)
            lines.push(`  - Resolution: ${finding.metadata.resolution.description}`);
    }
    return lines.join("\n");
}
function sourceFilesFrom(brownfield) {
    return brownfield.structure.files.filter((file) => CODE_EXTENSIONS.has(extname(file).toLowerCase()));
}
export function detectBrownfieldFindings(projectDir, brownfield, purpose) {
    const findings = [];
    const sourceFiles = sourceFilesFrom(brownfield);
    const testFiles = brownfield.test_files;
    const docs = brownfield.documentation_files;
    const detectors = ["brownfield-structure", "source-patterns", "test-coverage", "documentation-coverage"];
    if (sourceFiles.length > 0 && testFiles.length === 0) {
        findings.push({
            category: "test_gap",
            severity: "high",
            title: "Código executável sem testes detectados",
            observed_behavior: "O projeto possui arquivos de código, mas o scanner não encontrou testes automatizados.",
            expected_behavior: "Comportamentos relevantes devem possuir testes unitários, de integração ou end-to-end.",
            purpose,
            confidence: 0.88,
            remediation: "Adicionar testes para os fluxos críticos e registrar os cenários de aceitação.",
            target_behavior: "O novo sistema deve nascer com cobertura automatizada para os fluxos críticos.",
            source_files: sourceFiles,
            evidence: [{ kind: "scan", detector: "test-coverage", excerpt: `source_files=${sourceFiles.length}; test_files=0`, confidence: 0.88 }],
        });
    }
    if (sourceFiles.length > 0 && docs.length === 0) {
        findings.push({
            category: "documentation",
            severity: "low",
            title: "Documentação de projeto não detectada",
            observed_behavior: "O projeto não possui README, CHANGELOG ou diretório de documentação detectável.",
            expected_behavior: "O comportamento público e as decisões relevantes devem estar documentados.",
            purpose,
            confidence: 0.82,
            remediation: "Criar documentação de uso, arquitetura e operação.",
            target_behavior: "O novo sistema deve possuir documentação mínima para operação e manutenção.",
            source_files: [],
            evidence: [{ kind: "scan", detector: "documentation-coverage", excerpt: "documentation_files=0", confidence: 0.82 }],
        });
    }
    for (const file of sourceFiles) {
        let content = "";
        try {
            content = readFileSync(`${projectDir}/${file}`, "utf-8");
        }
        catch {
            continue;
        }
        const todo = content.match(/\b(TODO|FIXME|HACK)\b[^\n]*/i)?.[0];
        if (todo)
            findings.push({
                category: "quality",
                severity: /FIXME|HACK/i.test(todo) ? "medium" : "low",
                title: `Pendência explícita em ${file}`,
                observed_behavior: `O arquivo contém uma anotação de pendência: ${todo.trim().slice(0, 180)}`,
                expected_behavior: "Pendências relevantes devem ser resolvidas ou formalizadas no SDD.",
                purpose,
                confidence: 0.95,
                remediation: "Resolver a pendência e adicionar teste ou decisão que justifique a implementação.",
                target_behavior: "A decisão correspondente deve ser explícita no SDD do novo sistema.",
                source_files: [file],
                evidence: [{ kind: "file", path: file, detector: "source-patterns", excerpt: todo.trim().slice(0, 180), confidence: 0.95 }],
            });
        if (/\bdebugger\b|\bconsole\.(?:log|debug|trace)\s*\(/.test(content))
            findings.push({
                category: "quality",
                severity: "low",
                title: `Log de depuração em ${file}`,
                observed_behavior: "O arquivo contém saída de depuração diretamente no código de produção.",
                expected_behavior: "Logs devem usar a estratégia observável e configurável do sistema.",
                purpose,
                confidence: 0.78,
                remediation: "Substituir a saída direta por logging estruturado ou removê-la.",
                target_behavior: "O novo sistema deve usar logging estruturado e controlado por ambiente.",
                source_files: [file],
                evidence: [{ kind: "file", path: file, detector: "source-patterns", confidence: 0.78 }],
            });
        if (/\bany\b/.test(content) && /\.(?:ts|tsx)$/.test(file))
            findings.push({
                category: "quality",
                severity: "medium",
                title: `Tipagem fraca em ${file}`,
                observed_behavior: "O arquivo TypeScript utiliza o tipo any, reduzindo a verificação estática.",
                expected_behavior: "Contratos públicos devem possuir tipos explícitos ou justificativa registrada.",
                purpose,
                confidence: 0.74,
                remediation: "Substituir any por tipos explícitos ou registrar a exceção arquitetural.",
                target_behavior: "O novo sistema deve preservar contratos tipados nos limites públicos.",
                source_files: [file],
                evidence: [{ kind: "file", path: file, detector: "source-patterns", confidence: 0.74 }],
            });
        if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(content))
            findings.push({
                category: "quality",
                severity: "high",
                title: `Erro descartado silenciosamente em ${file}`,
                observed_behavior: "Existe um bloco catch vazio que descarta falhas sem tratamento ou telemetria.",
                expected_behavior: "Falhas devem ser tratadas, propagadas ou registradas com contexto.",
                purpose,
                confidence: 0.9,
                remediation: "Definir tratamento de erro e teste para o cenário de falha.",
                target_behavior: "O novo sistema deve ter política explícita de tratamento de erros.",
                source_files: [file],
                evidence: [{ kind: "file", path: file, detector: "source-patterns", confidence: 0.9 }],
            });
        if (/(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{8,}["']/i.test(content))
            findings.push({
                category: "security",
                severity: "critical",
                title: `Possível segredo embutido em ${file}`,
                observed_behavior: "O arquivo contém uma string com aparência de credencial ou segredo.",
                expected_behavior: "Segredos devem ser fornecidos por armazenamento seguro ou variáveis protegidas.",
                purpose,
                confidence: 0.86,
                remediation: "Remover o segredo, rotacioná-lo e usar configuração segura.",
                target_behavior: "O novo sistema não deve armazenar credenciais em código-fonte.",
                source_files: [file],
                evidence: [{ kind: "file", path: file, detector: "source-patterns", confidence: 0.86 }],
            });
    }
    return { findings, filesInspected: sourceFiles.length, detectors };
}
