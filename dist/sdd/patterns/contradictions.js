import { getNodesByType } from "../graph/engine.js";
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js";
export function detectContradictions(graph, options) {
    const contradictions = [];
    // Build exclusion sets
    const excludeSet = new Set(options?.excludeNodeIds || []);
    const verifiedPairs = new Set();
    if (options?.alreadyVerified) {
        for (const pair of options.alreadyVerified) {
            verifiedPairs.add([pair.node_a, pair.node_b].sort().join("|||"));
        }
    }
    // Domain pre-filter: extract shared words for O(1) domain matching
    const domainIndex = buildDomainIndex(graph);
    const checkReq = !options?.focusNodeTypes || options.focusNodeTypes.includes("requirement");
    const checkRule = !options?.focusNodeTypes || options.focusNodeTypes.includes("business_rule");
    if (checkReq && !options?.excludeTypes?.includes("requirement_conflict")) {
        detectRequirementContradictions(graph, contradictions, options, excludeSet, verifiedPairs, domainIndex);
    }
    if (checkRule && !options?.excludeTypes?.includes("rule_conflict")) {
        detectRuleContradictions(graph, contradictions, options, excludeSet, verifiedPairs, domainIndex);
    }
    if (checkReq && checkRule && !options?.excludeTypes?.includes("cross_type_conflict")) {
        detectCrossTypeContradictions(graph, contradictions, options, excludeSet, verifiedPairs);
    }
    // Apply max results limit
    if (options?.maxResults && contradictions.length > options.maxResults) {
        contradictions.splice(options.maxResults);
    }
    const byType = {};
    for (const c of contradictions) {
        byType[c.type] = (byType[c.type] || 0) + 1;
    }
    return {
        contradictions,
        total: contradictions.length,
        by_type: byType,
    };
}
function filterByOptions(text, nodeId, options, excludeSet, verifiedPairs, otherId) {
    if (excludeSet?.has(nodeId))
        return false;
    if (otherId && verifiedPairs?.has([nodeId, otherId].sort().join("|||")))
        return false;
    if (options?.focusKeywords?.length) {
        const textLower = text.toLowerCase();
        if (!options.focusKeywords.some(kw => textLower.includes(kw.toLowerCase())))
            return false;
    }
    if (options?.focusDomains?.length) {
        const textLower = text.toLowerCase();
        if (!options.focusDomains.some(d => textLower.includes(d.toLowerCase())))
            return false;
    }
    return true;
}
function detectRequirementContradictions(graph, contradictions, options, excludeSet, verifiedPairs, domainIndex) {
    const { removed, deprecated } = getExclusionSets(graph);
    const requirements = getNodesByType(graph, "requirement")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))
        .filter((r) => filterByOptions(`${r.name} ${r.description || ''}`, r.id, options, excludeSet));
    // Smart: group by domain for O(n/k) comparisons instead of O(n²)
    if (domainIndex && options?.focusDomains?.length) {
        for (const domain of options.focusDomains) {
            const domainNodes = domainIndex.get(domain.toLowerCase()) || new Set();
            const domainReqs = requirements.filter(r => domainNodes.has(r.id));
            for (let i = 0; i < domainReqs.length; i++) {
                for (let j = i + 1; j < domainReqs.length; j++) {
                    if (verifiedPairs?.has([domainReqs[i].id, domainReqs[j].id].sort().join("|||")))
                        continue;
                    const conflict = findSemanticConflict(domainReqs[i], domainReqs[j]);
                    if (conflict) {
                        contradictions.push({ node_a: domainReqs[i].id, node_b: domainReqs[j].id, type: "requirement_conflict", description: conflict, severity: "warning" });
                    }
                }
            }
        }
    }
    else {
        for (let i = 0; i < requirements.length; i++) {
            for (let j = i + 1; j < requirements.length; j++) {
                if (verifiedPairs?.has([requirements[i].id, requirements[j].id].sort().join("|||")))
                    continue;
                const conflict = findSemanticConflict(requirements[i], requirements[j]);
                if (conflict) {
                    contradictions.push({ node_a: requirements[i].id, node_b: requirements[j].id, type: "requirement_conflict", description: conflict, severity: "warning" });
                }
            }
        }
    }
}
function detectRuleContradictions(graph, contradictions, options, excludeSet, verifiedPairs, domainIndex) {
    const { removed, deprecated } = getExclusionSets(graph);
    const rules = getNodesByType(graph, "business_rule")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))
        .filter((r) => filterByOptions(`${r.name} ${r.metadata?.rule_text || ''}`, r.id, options, excludeSet));
    if (domainIndex && options?.focusDomains?.length) {
        for (const domain of options.focusDomains) {
            const domainNodes = domainIndex.get(domain.toLowerCase()) || new Set();
            const domainRules = rules.filter(r => domainNodes.has(r.id));
            for (let i = 0; i < domainRules.length; i++) {
                for (let j = i + 1; j < domainRules.length; j++) {
                    if (verifiedPairs?.has([domainRules[i].id, domainRules[j].id].sort().join("|||")))
                        continue;
                    const conflict = findRuleConflict(domainRules[i], domainRules[j]);
                    if (conflict) {
                        contradictions.push({ node_a: domainRules[i].id, node_b: domainRules[j].id, type: "rule_conflict", description: conflict, severity: "error" });
                    }
                }
            }
        }
    }
    else {
        for (let i = 0; i < rules.length; i++) {
            for (let j = i + 1; j < rules.length; j++) {
                if (verifiedPairs?.has([rules[i].id, rules[j].id].sort().join("|||")))
                    continue;
                const conflict = findRuleConflict(rules[i], rules[j]);
                if (conflict) {
                    contradictions.push({ node_a: rules[i].id, node_b: rules[j].id, type: "rule_conflict", description: conflict, severity: "error" });
                }
            }
        }
    }
}
function detectCrossTypeContradictions(graph, contradictions, options, excludeSet, verifiedPairs) {
    const { removed, deprecated } = getExclusionSets(graph);
    const requirements = getNodesByType(graph, "requirement")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))
        .filter((r) => filterByOptions(`${r.name} ${r.description || ''}`, r.id, options, excludeSet));
    const rules = getNodesByType(graph, "business_rule")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))
        .filter((r) => filterByOptions(`${r.name} ${r.metadata?.rule_text || ''}`, r.id, options, excludeSet));
    for (const req of requirements) {
        for (const rule of rules) {
            if (verifiedPairs?.has([req.id, rule.id].sort().join("|||")))
                continue;
            const conflict = findCrossTypeConflict(req, rule);
            if (conflict) {
                contradictions.push({ node_a: req.id, node_b: rule.id, type: "cross_type_conflict", description: conflict, severity: "warning" });
            }
        }
    }
}
/**
 * Build a domain index mapping domain keywords to node IDs.
 * Used for O(1) domain-based filtering.
 */
function buildDomainIndex(graph) {
    const index = new Map();
    for (const node of graph.nodes) {
        const text = `${node.name} ${node.description || ''}`.toLowerCase();
        const words = text.split(/\s+/);
        for (const word of words) {
            if (word.length < 4)
                continue; // Skip short words
            if (!index.has(word))
                index.set(word, new Set());
            index.get(word).add(node.id);
        }
    }
    return index;
}
function findSemanticConflict(a, b) {
    const descA = (a.description || a.name).toLowerCase();
    const descB = (b.description || b.name).toLowerCase();
    const negationPairs = [
        ["allow", "forbid"], ["enable", "disable"], ["required", "optional"],
        ["include", "exclude"], ["must", "must not"], ["always", "never"],
    ];
    for (const [pos, neg] of negationPairs) {
        if ((descA.includes(pos) && descB.includes(neg)) || (descA.includes(neg) && descB.includes(pos))) {
            return `Potentially contradictory requirements: "${a.name}" vs "${b.name}"`;
        }
    }
    return null;
}
function findRuleConflict(a, b) {
    const ruleTextA = a.metadata?.rule_text?.toLowerCase();
    const ruleTextB = b.metadata?.rule_text?.toLowerCase();
    if (!ruleTextA || !ruleTextB)
        return null;
    if (ruleTextA.includes("always") && ruleTextB.includes("never")) {
        if (isSameDomain(ruleTextA, ruleTextB)) {
            return `Conflicting rules: "${a.metadata.rule_text}" vs "${b.metadata.rule_text}"`;
        }
    }
    if (ruleTextA.includes("allow") && ruleTextB.includes("deny")) {
        if (isSameDomain(ruleTextA, ruleTextB)) {
            return `Conflicting rules: "${a.metadata.rule_text}" vs "${b.metadata.rule_text}"`;
        }
    }
    return null;
}
function findCrossTypeConflict(req, rule) {
    const reqText = (req.description || req.name).toLowerCase();
    const ruleText = rule.metadata?.rule_text?.toLowerCase();
    if (!ruleText)
        return null;
    if (reqText.includes("allow") && ruleText.includes("deny")) {
        if (isSameDomain(reqText, ruleText)) {
            return `Requirement "${req.name}" allows something that business rule "${rule.name}" denies`;
        }
    }
    if (reqText.includes("require") && ruleText.includes("forbid")) {
        if (isSameDomain(reqText, ruleText)) {
            return `Requirement "${req.name}" requires something that business rule "${rule.name}" forbids`;
        }
    }
    return null;
}
function isSameDomain(textA, textB) {
    const wordsA = new Set(textA.split(/\s+/));
    const wordsB = new Set(textB.split(/\s+/));
    const overlap = [...wordsA].filter((w) => wordsB.has(w) && w.length > 3);
    return overlap.length >= 2;
}
export function formatContradictionReport(report) {
    const lines = [
        `## Contradictions (${report.total} total)`,
        "",
    ];
    if (report.total === 0) {
        lines.push("✅ No contradictions detected.");
        return lines.join("\n");
    }
    for (const [type, count] of Object.entries(report.by_type)) {
        lines.push(`- **${type}**: ${count}`);
    }
    lines.push("");
    for (const c of report.contradictions) {
        const severity = c.severity === "error" ? "🔴" : "🟡";
        lines.push(`${severity} **${c.node_a}** ↔ **${c.node_b}**: ${c.description}`);
    }
    return lines.join("\n");
}
