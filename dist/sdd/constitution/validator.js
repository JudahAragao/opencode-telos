import { getNodesByType } from "../graph/engine.js";
export function validateAgainstConstitution(graph, options) {
    const constitutions = getNodesByType(graph, "constitution");
    const violations = [];
    if (constitutions.length === 0) {
        return { violations: [], score: 1, total_principles: 0, checked_nodes: 0 };
    }
    // Filter principles by options
    let allPrinciples = constitutions.flatMap((c) => (c.metadata.principles || []).map((p) => ({
        ...p,
        constitution_id: c.id,
    })));
    if (options?.focusPrincipleIds?.length) {
        allPrinciples = allPrinciples.filter(p => options.focusPrincipleIds.includes(p.id));
    }
    if (options?.excludePrincipleIds?.length) {
        const excludeSet = new Set(options.excludePrincipleIds);
        allPrinciples = allPrinciples.filter(p => !excludeSet.has(p.id));
    }
    // Filter nodes by options
    const excludeNodeSet = new Set(options?.excludeNodeIds || []);
    let nodesToCheck = graph.nodes.filter(n => n.type !== "constitution" && n.type !== "project" && !excludeNodeSet.has(n.id));
    if (options?.focusNodeTypes?.length) {
        const typeSet = new Set(options.focusNodeTypes);
        nodesToCheck = nodesToCheck.filter(n => typeSet.has(n.type));
    }
    if (options?.focusKeywords?.length) {
        nodesToCheck = nodesToCheck.filter(n => {
            const text = `${n.name} ${n.description || ''}`.toLowerCase();
            return options.focusKeywords.some(kw => text.includes(kw.toLowerCase()));
        });
    }
    let checkedNodes = 0;
    // Build principle scope index for O(1) scope matching
    const principleScopeIndex = options?.skipScopeFilter ? null : buildPrincipleScopeIndex(allPrinciples);
    for (const node of nodesToCheck) {
        checkedNodes++;
        const nodeStr = JSON.stringify(node).toLowerCase();
        for (const principle of allPrinciples) {
            // Smart scope filtering: skip principles that don't apply to this node type
            if (principleScopeIndex) {
                const applicableTypes = principleScopeIndex.get(principle.id);
                if (applicableTypes && !applicableTypes.has(node.type))
                    continue;
            }
            const scopeRegex = principle.scope ? new RegExp(principle.scope, "i") : null;
            if (scopeRegex && !scopeRegex.test(nodeStr))
                continue;
            const cacheKey = `${node.id}||${principle.id}`;
            let violation = null;
            if (options?.cache?.has(cacheKey)) {
                violation = options.cache.get(cacheKey) || null;
            }
            else {
                violation = checkPrinciple(principle, node);
                if (options?.cache) {
                    options.cache.set(cacheKey, violation);
                }
            }
            if (violation) {
                violations.push(violation);
            }
        }
    }
    // Apply max results limit
    if (options?.maxResults && violations.length > options.maxResults) {
        violations.splice(options.maxResults);
    }
    const mustViolations = violations.filter((v) => v.severity === "must").length;
    const shouldViolations = violations.filter((v) => v.severity === "should").length;
    const penalty = (mustViolations * 0.1 + shouldViolations * 0.03);
    const score = Math.max(0, 1 - penalty);
    return {
        violations,
        score,
        total_principles: allPrinciples.length,
        checked_nodes: checkedNodes,
    };
}
/**
 * Build an index mapping principle IDs to the node types they apply to.
 * Extracted from scope regex patterns to avoid regex testing on every node.
 */
function buildPrincipleScopeIndex(principles) {
    const index = new Map();
    for (const p of principles) {
        if (!p.scope)
            continue;
        const types = new Set();
        // Extract node types from common scope patterns
        if (/entity|entidade/i.test(p.scope))
            types.add("entity");
        if (/endpoint|rota|api/i.test(p.scope))
            types.add("endpoint");
        if (/feature|funcionalidade/i.test(p.scope))
            types.add("feature");
        if (/requirement|requisito/i.test(p.scope))
            types.add("requirement");
        if (/file|arquivo/i.test(p.scope))
            types.add("file");
        if (/architecture|arquitetura/i.test(p.scope))
            types.add("architecture_component");
        if (/rule|regra/i.test(p.scope))
            types.add("business_rule");
        if (/task|tarefa/i.test(p.scope))
            types.add("task");
        if (/test|teste/i.test(p.scope))
            types.add("test");
        if (types.size > 0)
            index.set(p.id, types);
    }
    return index;
}
function checkPrinciple(principle, node) {
    const rule = principle.rule.toLowerCase();
    const nodeJson = JSON.stringify(node).toLowerCase();
    if (rule.includes("never") || rule.includes("nunca")) {
        const forbidden = extractForbiddenPattern(rule);
        if (forbidden && nodeJson.includes(forbidden)) {
            return {
                principle_id: principle.id,
                node_id: node.id,
                description: `Node "${node.name}" violates principle: ${principle.rule}`,
                severity: principle.severity,
            };
        }
    }
    if (rule.includes("always") || rule.includes("sempre")) {
        const required = extractRequiredPattern(rule);
        if (required && !nodeJson.includes(required)) {
            return {
                principle_id: principle.id,
                node_id: node.id,
                description: `Node "${node.name}" missing required element per principle: ${principle.rule}`,
                severity: principle.severity,
            };
        }
    }
    if (rule.includes("must not") || rule.includes("deve") && rule.includes("não")) {
        const forbidden = extractForbiddenPattern(rule);
        if (forbidden && nodeJson.includes(forbidden)) {
            return {
                principle_id: principle.id,
                node_id: node.id,
                description: `Node "${node.name}" violates constraint: ${principle.rule}`,
                severity: principle.severity,
            };
        }
    }
    return null;
}
function extractForbiddenPattern(rule) {
    const neverMatch = rule.match(/never\s+(?:use|include|contain|allow)\s+(\S+)/i);
    if (neverMatch)
        return neverMatch[1].toLowerCase();
    const nuncaMatch = rule.match(/nunca\s+(?:usar|incluir|conter|permitir)\s+(\S+)/i);
    if (nuncaMatch)
        return nuncaMatch[1].toLowerCase();
    return null;
}
function extractRequiredPattern(rule) {
    const alwaysMatch = rule.match(/always\s+(?:use|include|contain)\s+(\S+)/i);
    if (alwaysMatch)
        return alwaysMatch[1].toLowerCase();
    const sempreMatch = rule.match(/sempre\s+(?:usar|incluir|conter)\s+(\S+)/i);
    if (sempreMatch)
        return sempreMatch[1].toLowerCase();
    return null;
}
export function formatConstitutionResult(result) {
    if (result.total_principles === 0) {
        return "No constitution defined. Use sdd.constitution to define project principles.";
    }
    const lines = [
        `## Constitution Compliance`,
        `**Principles:** ${result.total_principles}`,
        `**Nodes checked:** ${result.checked_nodes}`,
        `**Score:** ${(result.score * 100).toFixed(1)}%`,
        `**Violations:** ${result.violations.length}`,
    ];
    if (result.violations.length > 0) {
        lines.push("");
        lines.push("### Violations");
        for (const v of result.violations) {
            lines.push(`- [${v.severity}] **${v.principle_id}** on ${v.node_id}: ${v.description}`);
        }
    }
    return lines.join("\n");
}
