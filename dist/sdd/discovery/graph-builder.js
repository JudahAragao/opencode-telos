import { addNode, addRelationship, getNode } from "../graph/engine.js";
import { ensureGraphIntegrity } from "../graph/integrity.js";
import { progressEmitter } from "../../server/events.js";
function safeId(projectId, type, name) {
    const clean = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
    return `${projectId}-${type.toUpperCase().slice(0, 4)}-${clean}`;
}
function now() {
    return new Date().toISOString();
}
// ─── Node Builders ─────────────────────────────────────────────────
function buildFeatureNodes(graph, features) {
    let count = 0;
    for (const f of features) {
        const id = safeId(graph.project_id, "feature", f.name);
        if (getNode(graph, id))
            continue;
        try {
            addNode(graph, {
                id,
                type: "feature",
                name: f.name,
                description: f.description,
                status: "DRAFT",
                version: 1,
                metadata: { priority: f.priority, phase: f.phase },
                created_at: now(),
                updated_at: now(),
            });
            count++;
        }
        catch { /* skip duplicates */ }
    }
    return count;
}
function buildEntityNodes(graph, entities) {
    let count = 0;
    for (const e of entities) {
        const id = safeId(graph.project_id, "entity", e.name);
        if (getNode(graph, id))
            continue;
        try {
            addNode(graph, {
                id,
                type: "entity",
                name: e.name,
                description: e.description,
                status: "DRAFT",
                version: 1,
                metadata: { fields: e.fields },
                created_at: now(),
                updated_at: now(),
            });
            count++;
        }
        catch { /* skip */ }
    }
    return count;
}
function buildEndpointNodes(graph, endpoints) {
    let count = 0;
    for (const ep of endpoints) {
        const id = safeId(graph.project_id, "endpoint", `${ep.method}-${ep.path}`);
        if (getNode(graph, id))
            continue;
        try {
            addNode(graph, {
                id,
                type: "endpoint",
                name: `${ep.method} ${ep.path}`,
                description: ep.description,
                status: "DRAFT",
                version: 1,
                metadata: {
                    method: ep.method,
                    path: ep.path,
                    relatedEntity: ep.relatedEntity,
                },
                created_at: now(),
                updated_at: now(),
            });
            count++;
        }
        catch { /* skip */ }
    }
    return count;
}
function buildBusinessRuleNodes(graph, rules) {
    let count = 0;
    for (const r of rules) {
        const id = safeId(graph.project_id, "rule", r.name);
        if (getNode(graph, id))
            continue;
        try {
            addNode(graph, {
                id,
                type: "business_rule",
                name: r.name,
                description: r.description,
                status: "DRAFT",
                version: 1,
                metadata: { rule_text: r.description },
                created_at: now(),
                updated_at: now(),
            });
            count++;
        }
        catch { /* skip */ }
    }
    return count;
}
function buildArchitectureNodes(graph, components) {
    let count = 0;
    for (const c of components) {
        const id = safeId(graph.project_id, "arch", c.name);
        if (getNode(graph, id))
            continue;
        try {
            addNode(graph, {
                id,
                type: "architecture_component",
                name: c.name,
                description: c.description,
                status: "DRAFT",
                version: 1,
                metadata: { layer: c.layer, technology: c.technology },
                created_at: now(),
                updated_at: now(),
            });
            count++;
        }
        catch { /* skip */ }
    }
    return count;
}
function buildDecisionNodes(graph, decisions) {
    let count = 0;
    for (const d of decisions) {
        const id = safeId(graph.project_id, "decision", d.title);
        if (getNode(graph, id))
            continue;
        try {
            addNode(graph, {
                id,
                type: "decision",
                name: d.title,
                description: d.context,
                status: "DRAFT",
                version: 1,
                metadata: {
                    title: d.title,
                    context: d.context,
                    decision: d.decision,
                    consequences: d.consequences,
                },
                created_at: now(),
                updated_at: now(),
            });
            count++;
        }
        catch { /* skip */ }
    }
    return count;
}
function buildRequirementNodes(graph, requirements) {
    let count = 0;
    for (const r of requirements) {
        const id = safeId(graph.project_id, "req", r.name);
        if (getNode(graph, id))
            continue;
        try {
            addNode(graph, {
                id,
                type: "requirement",
                name: r.name,
                description: r.description,
                status: "DRAFT",
                version: 1,
                metadata: {
                    acceptance_criteria: r.acceptanceCriteria,
                    priority: r.priority,
                    req_type: r.type,
                },
                created_at: now(),
                updated_at: now(),
            });
            count++;
        }
        catch { /* skip */ }
    }
    return count;
}
// ─── Relationship Builder ──────────────────────────────────────────
function buildRelationships(graph, analysis) {
    let count = 0;
    const projectId = graph.project_id;
    // 1. Connect entities to database components
    const dbComponents = analysis.architectureComponents.filter((c) => c.layer === "database");
    for (const entity of analysis.entities) {
        const entityId = safeId(graph.project_id, "entity", entity.name);
        for (const db of dbComponents) {
            const dbId = safeId(graph.project_id, "arch", db.name);
            if (getNode(graph, entityId) && getNode(graph, dbId)) {
                try {
                    addRelationship(graph, entityId, dbId, "persists_to");
                    count++;
                }
                catch { /* skip */ }
            }
        }
    }
    // 2. Connect endpoints to entities
    for (const ep of analysis.endpoints) {
        if (!ep.relatedEntity)
            continue;
        const epId = safeId(graph.project_id, "endpoint", `${ep.method}-${ep.path}`);
        const entityId = safeId(graph.project_id, "entity", ep.relatedEntity);
        if (getNode(graph, epId) && getNode(graph, entityId)) {
            try {
                addRelationship(graph, epId, entityId, "exposes");
                count++;
            }
            catch { /* skip */ }
        }
    }
    // 3. Connect features to architecture components
    for (const feature of analysis.features) {
        const featureId = safeId(graph.project_id, "feature", feature.name);
        // Connect to relevant architecture components
        for (const comp of analysis.architectureComponents) {
            const compId = safeId(graph.project_id, "arch", comp.name);
            if (getNode(graph, featureId) && getNode(graph, compId)) {
                // Features that mention the component name get connected
                if (feature.description.toLowerCase().includes(comp.name.toLowerCase()) ||
                    feature.name.toLowerCase().includes(comp.name.toLowerCase())) {
                    try {
                        addRelationship(graph, featureId, compId, "uses");
                        count++;
                    }
                    catch { /* skip */ }
                }
            }
        }
    }
    // 4. Connect features to entities
    for (const feature of analysis.features) {
        const featureId = safeId(graph.project_id, "feature", feature.name);
        for (const entity of analysis.entities) {
            const entityId = safeId(graph.project_id, "entity", entity.name);
            if (getNode(graph, featureId) && getNode(graph, entityId)) {
                if (feature.description.toLowerCase().includes(entity.name.toLowerCase()) ||
                    feature.name.toLowerCase().includes(entity.name.toLowerCase())) {
                    try {
                        addRelationship(graph, featureId, entityId, "uses");
                        count++;
                    }
                    catch { /* skip */ }
                }
            }
        }
    }
    // 5. Connect requirements to features
    for (const req of analysis.requirements) {
        const reqId = safeId(graph.project_id, "req", req.name);
        for (const feature of analysis.features) {
            const featureId = safeId(graph.project_id, "feature", feature.name);
            if (getNode(graph, reqId) && getNode(graph, featureId)) {
                if (req.name.toLowerCase().includes(feature.name.toLowerCase()) ||
                    feature.name.toLowerCase().includes(req.name.toLowerCase())) {
                    try {
                        addRelationship(graph, featureId, reqId, "satisfied_by");
                        count++;
                    }
                    catch { /* skip */ }
                }
            }
        }
    }
    // 6. Connect business rules to features
    for (const rule of analysis.businessRules) {
        const ruleId = safeId(graph.project_id, "rule", rule.name);
        for (const feature of analysis.features) {
            const featureId = safeId(graph.project_id, "feature", feature.name);
            if (getNode(graph, ruleId) && getNode(graph, featureId)) {
                if (rule.description.toLowerCase().includes(feature.name.toLowerCase()) ||
                    feature.description.toLowerCase().includes(rule.name.toLowerCase())) {
                    try {
                        addRelationship(graph, featureId, ruleId, "requires");
                        count++;
                    }
                    catch { /* skip */ }
                }
            }
        }
    }
    // 7. Connect architecture components to each other
    for (let i = 0; i < analysis.architectureComponents.length; i++) {
        for (let j = i + 1; j < analysis.architectureComponents.length; j++) {
            const a = analysis.architectureComponents[i];
            const b = analysis.architectureComponents[j];
            const aId = safeId(graph.project_id, "arch", a.name);
            const bId = safeId(graph.project_id, "arch", b.name);
            if (getNode(graph, aId) && getNode(graph, bId)) {
                // Frontend depends on backend, backend depends on database
                if ((a.layer === "frontend" && b.layer === "backend") ||
                    (a.layer === "backend" && b.layer === "database")) {
                    try {
                        addRelationship(graph, aId, bId, "depends_on");
                        count++;
                    }
                    catch { /* skip */ }
                }
                if ((b.layer === "frontend" && a.layer === "backend") ||
                    (b.layer === "backend" && a.layer === "database")) {
                    try {
                        addRelationship(graph, bId, aId, "depends_on");
                        count++;
                    }
                    catch { /* skip */ }
                }
            }
        }
    }
    // 8. Connect constitution to project root
    const constitutionId = `${graph.project_id}-CONSTITUTION`;
    if (getNode(graph, constitutionId)) {
        try {
            addRelationship(graph, projectId, constitutionId, "validates");
            count++;
        }
        catch { /* skip */ }
    }
    // 9. Connect decisions to related features/entities (not just to project root)
    for (const decision of analysis.decisions) {
        const decId = safeId(graph.project_id, "decision", decision.title);
        if (!getNode(graph, decId))
            continue;
        // Connect decision to features that share keywords
        for (const feature of analysis.features) {
            const featureId = safeId(graph.project_id, "feature", feature.name);
            if (!getNode(graph, featureId))
                continue;
            const decLower = decision.title.toLowerCase();
            const featLower = feature.name.toLowerCase();
            const featDescLower = feature.description.toLowerCase();
            if (decLower.includes(featLower) ||
                featLower.includes(decLower.split(" ")[0]) ||
                featDescLower.includes(decLower.split(" ")[0])) {
                try {
                    addRelationship(graph, decId, featureId, "influences");
                    count++;
                }
                catch { /* skip */ }
            }
        }
        // Connect decision to architecture components
        for (const comp of analysis.architectureComponents) {
            const compId = safeId(graph.project_id, "arch", comp.name);
            if (!getNode(graph, compId))
                continue;
            if (decision.title.toLowerCase().includes(comp.name.toLowerCase()) ||
                decision.context.toLowerCase().includes(comp.name.toLowerCase())) {
                try {
                    addRelationship(graph, decId, compId, "influences");
                    count++;
                }
                catch { /* skip */ }
            }
        }
    }
    // 10. Connect business rules to related requirements
    for (const rule of analysis.businessRules) {
        const ruleId = safeId(graph.project_id, "rule", rule.name);
        if (!getNode(graph, ruleId))
            continue;
        for (const req of analysis.requirements) {
            const reqId = safeId(graph.project_id, "req", req.name);
            if (!getNode(graph, reqId))
                continue;
            if (rule.description.toLowerCase().includes(req.name.toLowerCase().split(" ")[0]) ||
                req.name.toLowerCase().includes(rule.name.toLowerCase().split(" ")[0])) {
                try {
                    addRelationship(graph, ruleId, reqId, "constrains");
                    count++;
                }
                catch { /* skip */ }
            }
        }
    }
    // 11. Connect architecture components to business rules
    for (const comp of analysis.architectureComponents) {
        const compId = safeId(graph.project_id, "arch", comp.name);
        if (!getNode(graph, compId))
            continue;
        for (const rule of analysis.businessRules) {
            const ruleId = safeId(graph.project_id, "rule", rule.name);
            if (!getNode(graph, ruleId))
                continue;
            if (rule.description.toLowerCase().includes(comp.name.toLowerCase()) ||
                comp.description.toLowerCase().includes(rule.name.toLowerCase().split(" ")[0])) {
                try {
                    addRelationship(graph, ruleId, compId, "applies_to");
                    count++;
                }
                catch { /* skip */ }
            }
        }
    }
    // Note: Graph integrity (orphan connection, disconnected group merging,
    // redundant relationship cleanup) is handled by ensureGraphIntegrity()
    // called after buildRelationships in the main build function.
    return count;
}
// ─── Main Build Function ───────────────────────────────────────────
export function buildGraphFromAnalysis(graph, analysis) {
    const byType = {};
    const buildId = `build-${Date.now()}`;
    // Define build steps for progress tracking
    const steps = [
        "features",
        "entities",
        "endpoints",
        "business_rules",
        "architecture",
        "decisions",
        "requirements",
        "relationships",
        "connectivity",
    ];
    // Start build tracking
    progressEmitter.startBuild(buildId, steps);
    // Build all node types
    progressEmitter.nextStep("features", `Building feature nodes (${analysis.features.length} found)...`);
    byType.feature = buildFeatureNodes(graph, analysis.features);
    progressEmitter.stepProgress("features", `Created ${byType.feature} feature nodes`);
    progressEmitter.nextStep("entities", `Building entity nodes (${analysis.entities.length} found)...`);
    byType.entity = buildEntityNodes(graph, analysis.entities);
    progressEmitter.stepProgress("entities", `Created ${byType.entity} entity nodes`);
    progressEmitter.nextStep("endpoints", `Building endpoint nodes (${analysis.endpoints.length} found)...`);
    byType.endpoint = buildEndpointNodes(graph, analysis.endpoints);
    progressEmitter.stepProgress("endpoints", `Created ${byType.endpoint} endpoint nodes`);
    progressEmitter.nextStep("business_rules", `Building business rule nodes (${analysis.businessRules.length} found)...`);
    byType.business_rule = buildBusinessRuleNodes(graph, analysis.businessRules);
    progressEmitter.stepProgress("business_rules", `Created ${byType.business_rule} business rule nodes`);
    progressEmitter.nextStep("architecture", `Building architecture component nodes (${analysis.architectureComponents.length} found)...`);
    byType.architecture_component = buildArchitectureNodes(graph, analysis.architectureComponents);
    progressEmitter.stepProgress("architecture", `Created ${byType.architecture_component} architecture component nodes`);
    progressEmitter.nextStep("decisions", `Building decision nodes (${analysis.decisions.length} found)...`);
    byType.decision = buildDecisionNodes(graph, analysis.decisions);
    progressEmitter.stepProgress("decisions", `Created ${byType.decision} decision nodes`);
    progressEmitter.nextStep("requirements", `Building requirement nodes (${analysis.requirements.length} found)...`);
    byType.requirement = buildRequirementNodes(graph, analysis.requirements);
    progressEmitter.stepProgress("requirements", `Created ${byType.requirement} requirement nodes`);
    // Build relationships (includes orphan fallback)
    progressEmitter.nextStep("relationships", "Building relationships between nodes...");
    const relationshipsCreated = buildRelationships(graph, analysis);
    progressEmitter.stepProgress("relationships", `Created ${relationshipsCreated} relationships`);
    // Ensure full graph integrity: connect orphans, merge disconnected groups, clean redundancies
    progressEmitter.nextStep("connectivity", "Ensuring graph integrity...");
    const integrityReport = ensureGraphIntegrity(graph, { auto_fix: true });
    progressEmitter.stepProgress("connectivity", `Integrity: ${integrityReport.summary.fixes_applied} fixes applied, ` +
        `${integrityReport.summary.orphans_found} orphans, ` +
        `${integrityReport.summary.disconnected_groups_found} disconnected groups`);
    const nodesCreated = Object.values(byType).reduce((a, b) => a + b, 0);
    const totalFixes = integrityReport.summary.fixes_applied;
    // Complete build
    progressEmitter.complete(`Graph built: ${nodesCreated} nodes, ${relationshipsCreated} relationships, ${totalFixes} integrity fixes`, { nodesCreated, relationshipsCreated, integrityReport, byType });
    // Build summary
    const lines = [
        "## Graph Build Complete",
        "",
        `**Total nodes created:** ${nodesCreated}`,
        `**Total relationships created:** ${relationshipsCreated}`,
        `**Integrity fixes applied:** ${totalFixes}`,
        `**Graph connected:** ${integrityReport.summary.graph_connected ? "Yes" : "No"}`,
        "",
        "### Breakdown",
    ];
    for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
        if (count > 0)
            lines.push(`- **${type}:** ${count}`);
    }
    if (totalFixes > 0) {
        lines.push("");
        lines.push("### Integrity Fixes");
        for (const fix of integrityReport.fixes_applied.slice(0, 10)) {
            lines.push(`- ${fix.details}`);
        }
        if (integrityReport.fixes_applied.length > 10) {
            lines.push(`- ... and ${integrityReport.fixes_applied.length - 10} more`);
        }
    }
    lines.push("");
    lines.push("### Next Steps");
    lines.push("1. Run `sdd.validate` to check graph integrity");
    lines.push("2. Run `sdd.inspect` to see the complete graph");
    lines.push("3. Run `sdd.query_graph` to explore specific nodes");
    lines.push("4. Review and update node statuses as needed");
    return {
        nodesCreated,
        relationshipsCreated,
        byType,
        summary: lines.join("\n"),
    };
}
