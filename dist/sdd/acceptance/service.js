import { createHash } from "crypto";
import { addNode, addRelationship, getIncoming, getNode, updateNode } from "../graph/engine.js";
function criterionMetadata(node) {
    return node.metadata;
}
function normalizeText(text) {
    return text.trim().replace(/\s+/g, " ");
}
export function acceptanceContentHash(text) {
    return createHash("sha256").update(normalizeText(text)).digest("hex");
}
function criterionId(graph, requirementId, text) {
    const digest = acceptanceContentHash(text).slice(0, 16).toUpperCase();
    return `${graph.project_id}-AC-${requirementId.slice(-24)}-${digest}`;
}
function now() {
    return new Date().toISOString();
}
function requirementIdsForCriterion(graph, criterionId) {
    return getIncoming(graph, criterionId)
        .filter((rel) => rel.type === "has_acceptance_criterion")
        .map((rel) => rel.from);
}
export function getAcceptanceCriteria(graph, requirementId, includeLegacy = true) {
    const criteria = graph.relationships
        .filter((rel) => rel.from === requirementId && rel.type === "has_acceptance_criterion")
        .map((rel) => getNode(graph, rel.to))
        .filter((node) => node?.type === "acceptance_criterion");
    if (criteria.length > 0 || !includeLegacy)
        return criteria;
    const requirement = getNode(graph, requirementId);
    if (!requirement || requirement.type !== "requirement")
        return [];
    const legacy = requirement.metadata.acceptance_criteria;
    if (!Array.isArray(legacy))
        return [];
    return legacy
        .filter((text) => typeof text === "string" && text.trim().length > 0)
        .map((text, index) => ({
        id: `${graph.project_id}-LEGACY-AC-${requirementId.slice(-20)}-${index + 1}`,
        type: "acceptance_criterion",
        name: text.slice(0, 120),
        description: text,
        status: "PENDING",
        version: 1,
        metadata: {
            text,
            criterion_version: 1,
            content_hash: acceptanceContentHash(text),
            legacy_source: "requirement.metadata.acceptance_criteria",
        },
        created_at: requirement.created_at,
        updated_at: requirement.updated_at,
    }));
}
export function createAcceptanceCriterion(graph, requirementId, text, legacySource) {
    const requirement = getNode(graph, requirementId);
    if (!requirement || requirement.type !== "requirement") {
        throw new Error(`Requirement ${requirementId} not found`);
    }
    const normalized = normalizeText(text);
    if (!normalized)
        throw new Error("Acceptance criterion text cannot be empty");
    const hash = acceptanceContentHash(normalized);
    const existing = getAcceptanceCriteria(graph, requirementId, false).find((criterion) => criterion.metadata.content_hash === hash);
    if (existing)
        return existing;
    const id = criterionId(graph, requirementId, normalized);
    const timestamp = now();
    const node = {
        id,
        type: "acceptance_criterion",
        name: normalized.slice(0, 120),
        description: normalized,
        status: "PENDING",
        version: 1,
        metadata: {
            text: normalized,
            criterion_version: 1,
            content_hash: hash,
            ...(legacySource ? { legacy_source: legacySource } : {}),
        },
        created_at: timestamp,
        updated_at: timestamp,
    };
    addNode(graph, node);
    addRelationship(graph, requirementId, id, "has_acceptance_criterion", { source: "acceptance_service" });
    return node;
}
export function updateAcceptanceCriterionText(graph, criterionId, text, input) {
    const criterion = getNode(graph, criterionId);
    if (!criterion || criterion.type !== "acceptance_criterion") {
        throw new Error(`Acceptance criterion ${criterionId} not found`);
    }
    const current = criterion;
    const normalized = normalizeText(text);
    if (!normalized)
        throw new Error("Acceptance criterion text cannot be empty");
    const hash = acceptanceContentHash(normalized);
    if (hash === current.metadata.content_hash)
        return current;
    const metadata = {
        ...criterionMetadata(current),
        text: normalized,
        criterion_version: current.metadata.criterion_version + 1,
        content_hash: hash,
        previous_status: current.status,
        previous_hash: current.metadata.content_hash,
        ...(input.observation ? { observation: input.observation } : {}),
        accepted_by: undefined,
        accepted_at: undefined,
        evidence: undefined,
    };
    return updateNode(graph, criterionId, {
        name: normalized.slice(0, 120),
        description: normalized,
        status: "PENDING",
        metadata,
        created_by: input.actor,
    });
}
export class AcceptanceService {
    graph;
    includeLegacyFallback;
    constructor(graph, includeLegacyFallback = true) {
        this.graph = graph;
        this.includeLegacyFallback = includeLegacyFallback;
    }
    list(requirementId, includeLegacy = true) {
        if (requirementId)
            return getAcceptanceCriteria(this.graph, requirementId, includeLegacy && this.includeLegacyFallback);
        return this.graph.nodes.filter((node) => node.type === "acceptance_criterion");
    }
    summary(requirementId, includeLegacy = true) {
        const criteria = this.list(requirementId, includeLegacy);
        const counts = { total: criteria.length, pending: 0, accepted: 0, rejected: 0, waived: 0 };
        for (const criterion of criteria) {
            if (criterion.status === "PENDING")
                counts.pending++;
            else if (criterion.status === "ACCEPTED")
                counts.accepted++;
            else if (criterion.status === "REJECTED")
                counts.rejected++;
            else if (criterion.status === "WAIVED")
                counts.waived++;
        }
        return { ...counts, all_accepted: counts.total > 0 && counts.pending === 0 && counts.rejected === 0 };
    }
    create(requirementId, text, legacySource) {
        return createAcceptanceCriterion(this.graph, requirementId, text, legacySource);
    }
    transition(criterionId, status, input) {
        const node = getNode(this.graph, criterionId);
        if (!node || node.type !== "acceptance_criterion")
            throw new Error(`Acceptance criterion ${criterionId} not found`);
        const criterion = node;
        if (input.expected_version !== undefined && criterion.version !== input.expected_version) {
            throw new Error(`Acceptance criterion ${criterionId} version conflict: expected ${input.expected_version}, current ${criterion.version}`);
        }
        if (input.expected_hash !== undefined && criterion.metadata.content_hash !== input.expected_hash) {
            throw new Error(`Acceptance criterion ${criterionId} content hash conflict`);
        }
        if (status === "WAIVED" && !input.observation?.trim()) {
            throw new Error("A waiver requires an observation");
        }
        const timestamp = now();
        const metadata = {
            ...criterion.metadata,
            previous_status: criterion.status,
            ...(input.observation !== undefined ? { observation: input.observation } : {}),
            ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
            ...(status === "ACCEPTED" || status === "WAIVED"
                ? { accepted_by: input.actor, accepted_at: timestamp }
                : { accepted_by: undefined, accepted_at: undefined }),
        };
        const updated = updateNode(this.graph, criterionId, {
            status,
            metadata,
            created_by: input.actor,
        });
        return {
            criterion: updated,
            audit: {
                action: status === "ACCEPTED" ? "accept" : status === "REJECTED" ? "reject" : status === "WAIVED" ? "waive" : "reopen",
                criterion_id: criterionId,
                actor: input.actor,
                timestamp,
                previous_status: criterion.status,
                status,
                content_hash: criterion.metadata.content_hash,
                observation: input.observation,
            },
        };
    }
    accept(criterionId, input) {
        return this.transition(criterionId, "ACCEPTED", input);
    }
    reject(criterionId, input) {
        return this.transition(criterionId, "REJECTED", input);
    }
    waive(criterionId, input) {
        return this.transition(criterionId, "WAIVED", input);
    }
    reopen(criterionId, input) {
        return this.transition(criterionId, "PENDING", input);
    }
    acceptAll(requirementId, input) {
        let criteria = this.list(requirementId, false);
        // Legacy projects may still expose virtual criteria. Materialize them on
        // the first mutating operation so accept-all always updates persisted
        // records and remains a single auditable transaction for YAML/SQLite.
        if (criteria.length === 0) {
            const legacy = this.list(requirementId, true);
            for (const criterion of legacy)
                createAcceptanceCriterion(this.graph, requirementId, criterion.metadata.text, criterion.metadata.legacy_source);
            criteria = this.list(requirementId, false);
        }
        const result = {
            requirement_id: requirementId,
            selected: criteria.filter((criterion) => criterion.status === "PENDING").length,
            accepted: [],
            skipped: [],
            failed: [],
            timestamp: now(),
            actor: input.actor,
            audit: [],
        };
        // Preflight every pending criterion before mutating any of them. This is
        // what makes the operation atomic for both YAML snapshots and SQLite
        // transactions when the caller persists the graph once.
        for (const criterion of criteria) {
            if (criterion.status !== "PENDING")
                continue;
            if (input.expected_version !== undefined && criterion.version !== input.expected_version) {
                result.failed.push({ criterion_id: criterion.id, reason: `version conflict: expected ${input.expected_version}, current ${criterion.version}` });
            }
            if (input.expected_hash !== undefined && criterion.metadata.content_hash !== input.expected_hash) {
                result.failed.push({ criterion_id: criterion.id, reason: "content hash conflict" });
            }
        }
        if (result.failed.length > 0)
            return result;
        for (const criterion of criteria) {
            if (criterion.status !== "PENDING") {
                result.skipped.push(criterion.id);
                continue;
            }
            try {
                const transitioned = this.accept(criterion.id, input);
                result.accepted.push(criterion.id);
                result.audit.push(transitioned.audit);
            }
            catch (error) {
                result.failed.push({ criterion_id: criterion.id, reason: error instanceof Error ? error.message : String(error) });
                break;
            }
        }
        return result;
    }
    invalidateForRequirement(requirementId, actor, observation) {
        const events = [];
        for (const criterion of this.list(requirementId, false)) {
            if (criterion.status === "PENDING")
                continue;
            const transitioned = this.reopen(criterion.id, { actor, observation });
            events.push({ ...transitioned.audit, action: "invalidate" });
        }
        return events;
    }
    requirementForCriterion(criterionId) {
        return requirementIdsForCriterion(this.graph, criterionId)
            .map((id) => getNode(this.graph, id))
            .find((node) => node?.type === "requirement");
    }
}
export function checkChangeAcceptance(graph, changeId, options = {}) {
    const change = getNode(graph, changeId);
    if (!change || change.type !== "change") {
        return { allowed: false, requirements: [], pending: [], rejected: [], waived: [], reason: `Change ${changeId} not found` };
    }
    const requirementIds = new Set();
    for (const affectedId of change.metadata.affected_nodes || []) {
        const affected = getNode(graph, affectedId);
        if (!affected)
            continue;
        if (affected.type === "requirement")
            requirementIds.add(affected.id);
        if (affected.type === "acceptance_criterion") {
            for (const requirementId of requirementIdsForCriterion(graph, affected.id))
                requirementIds.add(requirementId);
        }
        for (const relationship of graph.relationships) {
            if (relationship.type === "implements" && relationship.from === affected.id && getNode(graph, relationship.to)?.type === "requirement")
                requirementIds.add(relationship.to);
            if (relationship.type === "specifies" && relationship.to === affected.id && getNode(graph, relationship.from)?.type === "requirement")
                requirementIds.add(relationship.from);
            if (relationship.type === "satisfied_by" && relationship.from === affected.id && getNode(graph, relationship.to)?.type === "requirement")
                requirementIds.add(relationship.to);
        }
    }
    const pending = [];
    const rejected = [];
    const waived = [];
    for (const requirementId of requirementIds) {
        for (const criterion of getAcceptanceCriteria(graph, requirementId, options.legacyFallback !== false)) {
            if (criterion.status === "PENDING")
                pending.push(criterion.id);
            if (criterion.status === "REJECTED")
                rejected.push(criterion.id);
            if (criterion.status === "WAIVED")
                waived.push(criterion.id);
        }
    }
    const allowed = pending.length === 0 && rejected.length === 0 && (options.allowWaived !== false || waived.length === 0);
    return {
        allowed,
        requirements: [...requirementIds],
        pending,
        rejected,
        waived,
        reason: allowed ? "" : `Acceptance incomplete: ${pending.length} pending, ${rejected.length} rejected and ${options.allowWaived === false ? waived.length : 0} non-waived criterion(s).`,
    };
}
export function materializeLegacyAcceptanceCriteria(graph) {
    let created = 0;
    let linked = 0;
    const unresolved = [];
    for (const requirement of graph.nodes.filter((node) => node.type === "requirement")) {
        const values = requirement.metadata.acceptance_criteria;
        if (!Array.isArray(values))
            continue;
        for (const value of values.filter((item) => typeof item === "string" && item.trim().length > 0)) {
            const before = getAcceptanceCriteria(graph, requirement.id, false).length;
            const criterion = createAcceptanceCriterion(graph, requirement.id, value, "requirement.metadata.acceptance_criteria");
            if (getAcceptanceCriteria(graph, requirement.id, false).length > before)
                created++;
            if (criterion)
                linked++;
        }
    }
    for (const task of graph.nodes.filter((node) => node.type === "task")) {
        const values = task.metadata.acceptance;
        if (!Array.isArray(values) || values.length === 0)
            continue;
        const requirementRel = graph.relationships.find((rel) => rel.from === task.id && rel.type === "implements" && getNode(graph, rel.to)?.type === "requirement");
        if (!requirementRel)
            unresolved.push(task.id);
        else {
            for (const value of values.filter((item) => typeof item === "string" && item.trim().length > 0)) {
                createAcceptanceCriterion(graph, requirementRel.to, value, `task:${task.id}`);
            }
        }
    }
    return { created, linked, unresolved };
}
