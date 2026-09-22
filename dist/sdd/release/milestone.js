/**
 * Serviço de Milestones e rastreabilidade por release.
 *
 * Um `milestone` é a âncora de entrega: agrupa changes, tasks, features e
 * requirements e permite responder "o que entra no Release X, o que está
 * implementado e o que não tem evidência de teste".
 *
 * Toda a lógica aqui é pura (opera sobre `KnowledgeGraph`) para ser reutilizada
 * pela tool `sdd.milestone`, pelo backfill de migração e por testes.
 */
import { addNode, addRelationship, getNode, updateNode } from "../graph/engine.js";
import { isRelationshipAllowed, relationshipKey } from "../graph/schema.js";
import { ensureMilestoneNodes } from "../discovery/relationship-inferencer.js";
/** Tipos que podem ser membros diretos de um milestone. */
export const MILESTONE_MEMBER_TYPES = new Set([
    "change", "task", "feature", "requirement", "use_case", "business_rule", "endpoint", "module",
]);
/** Arestas percorridas ao expandir o escopo de um release. Deliberadamente
 * restrito: não segue `persists_to`/`uses`/`calls`, senão o escopo puxaria o
 * grafo de código inteiro. */
const SCOPE_EDGE_TYPES = new Set([
    "affects", "modifies", "creates", "specifies", "implements", "implemented_by",
    "tested_by", "tests", "contains", "belongs_to",
]);
const MAX_SCOPE_DEPTH = 3;
const COMPLETED_STATUSES = new Set([
    "COMPLETED", "completed", "VERIFIED", "IMPLEMENTED", "implemented", "done",
]);
export function slugifyMilestone(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
}
export function getMilestoneNodes(graph) {
    return graph.nodes.filter((node) => node.type === "milestone");
}
export function getMilestone(graph, id) {
    const node = getNode(graph, id);
    return node?.type === "milestone" ? node : undefined;
}
export function createMilestone(graph, input) {
    const name = (input.name ?? "").trim();
    if (!name)
        throw new Error("Milestone name is required");
    const duplicate = getMilestoneNodes(graph).find((m) => m.name.toLowerCase() === name.toLowerCase());
    if (duplicate)
        throw new Error(`Milestone "${name}" already exists (${duplicate.id})`);
    const id = `MILESTONE-${slugifyMilestone(name)}`;
    if (getNode(graph, id))
        throw new Error(`Milestone id ${id} already exists`);
    const now = new Date().toISOString();
    const milestone = {
        id,
        type: "milestone",
        name,
        description: input.objective,
        status: input.status ?? "DRAFT",
        version: 1,
        metadata: {
            milestone_name: name,
            target_date: input.target_date,
            objective: input.objective,
            release_version: input.release_version,
            change_ids: [],
        },
        created_at: now,
        updated_at: now,
    };
    addNode(graph, milestone);
    // Todo milestone nasce ligado ao projeto (senão a integridade o trata como órfão).
    const project = getNode(graph, graph.project_id);
    if (project) {
        try {
            addRelationship(graph, project.id, milestone.id, "contains");
        }
        catch {
            // Já conectado.
        }
    }
    return milestone;
}
function memberEdgeType(fromType, toType) {
    if (isRelationshipAllowed("milestone", "contains", toType))
        return "contains";
    if (isRelationshipAllowed(fromType, "belongs_to", "milestone"))
        return "belongs_to";
    if (isRelationshipAllowed(fromType, "traces_to", "milestone"))
        return "traces_to";
    return null;
}
export function linkNodesToMilestone(graph, milestoneId, nodeIds) {
    const milestone = getMilestone(graph, milestoneId);
    if (!milestone)
        throw new Error(`Milestone ${milestoneId} not found`);
    let linked = 0;
    let skipped = 0;
    const notFound = [];
    const existing = new Set(graph.relationships.map((r) => relationshipKey(r.from, r.to, r.type)));
    for (const nodeId of nodeIds) {
        if (nodeId === milestone.id) {
            skipped++;
            continue;
        }
        const node = getNode(graph, nodeId);
        if (!node) {
            notFound.push(nodeId);
            continue;
        }
        const type = memberEdgeType(milestone.type, node.type);
        if (!type) {
            notFound.push(nodeId);
            continue;
        }
        const [from, to] = type === "contains" ? [milestone.id, node.id] : [node.id, milestone.id];
        const key = relationshipKey(from, to, type);
        if (existing.has(key)) {
            skipped++;
            continue;
        }
        try {
            addRelationship(graph, from, to, type, { created_by: "milestone-service" });
            existing.add(key);
            linked++;
        }
        catch {
            skipped++;
        }
    }
    if (linked > 0)
        syncMilestoneChangeIds(graph, milestone);
    return { linked, skipped, not_found: notFound };
}
export function unlinkNodesFromMilestone(graph, milestoneId, nodeIds) {
    const milestone = getMilestone(graph, milestoneId);
    if (!milestone)
        throw new Error(`Milestone ${milestoneId} not found`);
    const ids = new Set(nodeIds);
    const before = graph.relationships.length;
    graph.relationships = graph.relationships.filter((rel) => !(ids.has(rel.from) && rel.to === milestoneId) &&
        !(rel.from === milestoneId && ids.has(rel.to)));
    const removed = before - graph.relationships.length;
    if (removed > 0)
        syncMilestoneChangeIds(graph, milestone);
    return removed;
}
export function moveNodesToMilestone(graph, fromId, toId, nodeIds) {
    unlinkNodesFromMilestone(graph, fromId, nodeIds);
    return linkNodesToMilestone(graph, toId, nodeIds);
}
export function closeMilestone(graph, milestoneId, status = "COMPLETED") {
    const milestone = getMilestone(graph, milestoneId);
    if (!milestone)
        throw new Error(`Milestone ${milestoneId} not found`);
    const updates = { status };
    updates.metadata = {
        ...milestone.metadata,
        closed_at: new Date().toISOString(),
    };
    const updated = updateNode(graph, milestoneId, updates);
    return updated;
}
/** Mantém `metadata.change_ids` em sincronia com as arestas (espelho de leitura). */
function syncMilestoneChangeIds(graph, milestone) {
    const ids = new Set();
    for (const rel of graph.relationships) {
        if (rel.from === milestone.id && (rel.type === "contains" || rel.type === "belongs_to"))
            ids.add(rel.to);
        else if (rel.to === milestone.id && (rel.type === "belongs_to" || rel.type === "contains"))
            ids.add(rel.from);
    }
    const members = [...ids].filter((id) => {
        const type = getNode(graph, id)?.type;
        return type === "change" || type === "task";
    });
    const current = getMilestone(graph, milestone.id);
    if (!current)
        return;
    const updates = {};
    updates.metadata = {
        ...current.metadata,
        change_ids: members,
    };
    updateNode(graph, milestone.id, updates);
}
// ── Escopo do release ────────────────────────────────────────────────
function directMemberIds(graph, milestone) {
    const ids = new Set();
    const meta = milestone.metadata;
    for (const rel of graph.relationships) {
        if (rel.from === milestone.id && rel.type === "contains")
            ids.add(rel.to);
        else if (rel.to === milestone.id && rel.type === "belongs_to")
            ids.add(rel.from);
    }
    for (const id of Array.isArray(meta.change_ids) ? meta.change_ids : []) {
        if (typeof id === "string")
            ids.add(id);
    }
    // Membros declarados por metadata (change/task com milestone_id ou nome).
    for (const node of graph.nodes) {
        if (node.type !== "change" && node.type !== "task")
            continue;
        const nodeMeta = node.metadata;
        if (nodeMeta.milestone_id === milestone.id) {
            ids.add(node.id);
            continue;
        }
        const declared = [nodeMeta.milestone, nodeMeta.milestone_name, nodeMeta.release]
            .flat()
            .filter((v) => typeof v === "string");
        if (declared.some((value) => value.toLowerCase() === milestone.name.toLowerCase()))
            ids.add(node.id);
    }
    ids.delete(milestone.id);
    return ids;
}
/**
 * Expande os membros diretos seguindo apenas arestas de rastreabilidade
 * (mudança → spec, requisito → feature, código → feature, teste → requisito),
 * com profundidade limitada.
 */
function collectReleaseScope(graph, milestone) {
    const outgoing = new Map();
    const incoming = new Map();
    for (const rel of graph.relationships) {
        if (!SCOPE_EDGE_TYPES.has(rel.type))
            continue;
        const out = outgoing.get(rel.from);
        if (out)
            out.push(rel);
        else
            outgoing.set(rel.from, [rel]);
        const inc = incoming.get(rel.to);
        if (inc)
            inc.push(rel);
        else
            incoming.set(rel.to, [rel]);
    }
    const visited = new Set(directMemberIds(graph, milestone));
    const queue = [...visited].map((id) => ({ id, depth: 0 }));
    while (queue.length > 0) {
        const { id, depth } = queue.shift();
        if (depth >= MAX_SCOPE_DEPTH)
            continue;
        const neighbors = [
            ...(outgoing.get(id) ?? []).map((rel) => rel.to),
            ...(incoming.get(id) ?? []).map((rel) => rel.from),
        ];
        for (const neighbor of neighbors) {
            if (visited.has(neighbor))
                continue;
            visited.add(neighbor);
            queue.push({ id: neighbor, depth: depth + 1 });
        }
    }
    return visited;
}
function linksTo(graph, id, type, direction) {
    return graph.relationships
        .filter((rel) => (direction === "out" ? rel.from === id : rel.to === id) && rel.type === type)
        .map((rel) => (direction === "out" ? rel.to : rel.from));
}
function buildMilestoneReport(graph, milestone) {
    const scope = collectReleaseScope(graph, milestone);
    const byType = (type) => [...scope].filter((id) => getNode(graph, id)?.type === type);
    const changes = byType("change");
    const tasks = byType("task");
    const features = byType("feature");
    const requirements = byType("requirement");
    const endpoints = byType("endpoint");
    const files = byType("file");
    const tests = byType("test");
    const completedTasks = tasks.filter((id) => {
        const task = getNode(graph, id);
        if (!task)
            return false;
        if (COMPLETED_STATUSES.has(task.status))
            return true;
        return task.metadata.board_column === "done";
    });
    const featureIdSet = new Set(features);
    // Requirement coberto = tem aresta tested_by/tests explícita para um teste.
    const requirementsUntested = requirements.filter((id) => {
        const explicit = [...linksTo(graph, id, "tested_by", "out"), ...linksTo(graph, id, "tests", "in")];
        return explicit.length === 0;
    });
    // Feature implementada = recebe `implements` de endpoint/file/module.
    const featuresUnlinked = features.filter((id) => {
        const implementers = linksTo(graph, id, "implements", "in");
        return !implementers.some((from) => {
            const type = getNode(graph, from)?.type;
            return type === "endpoint" || type === "file" || type === "module";
        });
    });
    // Endpoint/arquivo rastreado = aponta `implements` para alguma feature do release.
    const endpointsUnlinked = endpoints.filter((id) => !linksTo(graph, id, "implements", "out").some((to) => featureIdSet.has(to)));
    const filesUnlinked = files.filter((id) => !linksTo(graph, id, "implements", "out").some((to) => featureIdSet.has(to)));
    const progress = tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0;
    return {
        id: milestone.id,
        name: milestone.name,
        release_version: milestone.metadata.release_version,
        status: milestone.status,
        target_date: milestone.metadata.target_date,
        counts: {
            changes: changes.length,
            tasks: tasks.length,
            features: features.length,
            requirements: requirements.length,
            endpoints: endpoints.length,
            files: files.length,
            tests: tests.length,
        },
        progress_percent: progress,
        coverage: {
            requirements_total: requirements.length,
            requirements_tested: requirements.length - requirementsUntested.length,
            requirements_untested: requirementsUntested,
            features_total: features.length,
            features_linked: features.length - featuresUnlinked.length,
            features_unlinked: featuresUnlinked,
            endpoints_total: endpoints.length,
            endpoints_unlinked: endpointsUnlinked,
            files_total: files.length,
            files_unlinked: filesUnlinked,
        },
    };
}
export function buildReleaseReport(graph, milestoneId) {
    const milestones = milestoneId
        ? [getMilestone(graph, milestoneId)].filter((m) => Boolean(m))
        : getMilestoneNodes(graph);
    if (milestoneId && milestones.length === 0) {
        throw new Error(`Milestone ${milestoneId} not found`);
    }
    const assigned = new Set();
    for (const milestone of milestones) {
        for (const id of directMemberIds(graph, milestone))
            assigned.add(id);
    }
    const changes = graph.nodes.filter((n) => n.type === "change").map((n) => n.id);
    const tasks = graph.nodes.filter((n) => n.type === "task").map((n) => n.id);
    return {
        milestones: milestones.map((m) => buildMilestoneReport(graph, m)),
        unassigned: {
            changes: changes.filter((id) => !assigned.has(id)),
            tasks: tasks.filter((id) => !assigned.has(id)),
        },
        generated_at: new Date().toISOString(),
    };
}
export function formatReleaseReport(report, nameOf) {
    const label = (id) => nameOf?.(id) ?? id;
    const lines = ["## Rastreabilidade por Release", ""];
    if (report.milestones.length === 0) {
        lines.push("Nenhum milestone definido.");
        return lines.join("\n");
    }
    for (const m of report.milestones) {
        const version = m.release_version ? ` · ${m.release_version}` : "";
        lines.push(`### ${m.name}${version}`);
        lines.push(`**Status:** ${m.status}${m.target_date ? ` · **Alvo:** ${m.target_date}` : ""}`);
        lines.push(`**Escopo:** ${m.counts.changes} change(s), ${m.counts.tasks} task(s), ` +
            `${m.counts.features} feature(s), ${m.counts.requirements} requisito(s), ` +
            `${m.counts.endpoints} endpoint(s), ${m.counts.files} arquivo(s), ${m.counts.tests} teste(s)`);
        lines.push(`**Progresso (tasks concluídas):** ${m.progress_percent}%`);
        lines.push("");
        lines.push(`**Cobertura:** ${m.coverage.requirements_tested}/${m.coverage.requirements_total} requisitos com teste · ` +
            `${m.coverage.features_linked}/${m.coverage.features_total} features com implementação`);
        const gaps = [];
        if (m.coverage.requirements_untested.length > 0) {
            gaps.push(`- Sem teste (${m.coverage.requirements_untested.length}): ${m.coverage.requirements_untested.slice(0, 8).map(label).join(", ")}`);
        }
        if (m.coverage.features_unlinked.length > 0) {
            gaps.push(`- Feature sem endpoint/arquivo (${m.coverage.features_unlinked.length}): ${m.coverage.features_unlinked.slice(0, 8).map(label).join(", ")}`);
        }
        if (m.coverage.endpoints_unlinked.length > 0) {
            gaps.push(`- Endpoint sem feature (${m.coverage.endpoints_unlinked.length}): ${m.coverage.endpoints_unlinked.slice(0, 8).map(label).join(", ")}`);
        }
        if (m.coverage.files_unlinked.length > 0) {
            gaps.push(`- Arquivo sem feature (${m.coverage.files_unlinked.length}): ${m.coverage.files_unlinked.slice(0, 8).map(label).join(", ")}`);
        }
        if (gaps.length > 0) {
            lines.push("");
            lines.push("**Gaps de rastreabilidade:**");
            lines.push(...gaps);
        }
        lines.push("");
    }
    if (report.unassigned.changes.length > 0 || report.unassigned.tasks.length > 0) {
        lines.push("### Não atribuídos a nenhum release");
        lines.push(`- Changes: ${report.unassigned.changes.length}`);
        lines.push(`- Tasks: ${report.unassigned.tasks.length}`);
        lines.push("");
    }
    return lines.join("\n");
}
// ── Reexport conveniente ────────────────────────────────────────────
export { ensureMilestoneNodes };
