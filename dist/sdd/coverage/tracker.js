import { getNodesByType } from "../graph/engine.js";
import { getExclusionSets, isNodeExcludedOrDeprecated } from "../drift/exclusion.js";
export function calculateCoverage(graph, options) {
    const { removed, deprecated } = getExclusionSets(graph);
    const excludeReqSet = new Set(options?.excludeRequirements || []);
    const excludeTestSet = new Set(options?.excludeTests || []);
    let requirements = getNodesByType(graph, "requirement")
        .filter((r) => !isNodeExcludedOrDeprecated(r.id, r.status, removed, deprecated))
        .filter((r) => !excludeReqSet.has(r.id));
    // Apply focus filters
    if (options?.focusRequirements?.length) {
        const focusSet = new Set(options.focusRequirements);
        requirements = requirements.filter(r => focusSet.has(r.id));
    }
    if (options?.focusKeywords?.length) {
        requirements = requirements.filter(r => {
            const text = `${r.name} ${r.description || ''}`.toLowerCase();
            return options.focusKeywords.some(kw => text.includes(kw.toLowerCase()));
        });
    }
    const items = [];
    const gaps = [];
    // Find orphan tests (tests not linked to any requirement)
    const allTests = graph.nodes.filter((n) => n.type === "test" && !excludeTestSet.has(n.id));
    const testedReqIds = new Set(graph.relationships
        .filter((r) => r.type === "tested_by")
        .map((r) => r.to));
    const orphanTests = allTests
        .filter((t) => !testedReqIds.has(t.id))
        .map((t) => {
        const inferred = inferRequirementFromTest(t, requirements, graph);
        return {
            test_id: t.id,
            test_name: t.name,
            test_path: t.metadata?.target,
            inferred_requirement_id: inferred?.requirement_id,
            inferred_by: inferred?.method,
        };
    });
    for (const req of requirements) {
        const testRelationships = graph.relationships
            .filter((r) => r.from === req.id && r.type === "tested_by");
        const testIds = testRelationships.map((r) => r.to)
            .filter(id => !excludeTestSet.has(id));
        const tests = testIds
            .map((id) => graph.nodes.find((n) => n.id === id))
            .filter(Boolean);
        let aspects = extractAspects(req);
        // Apply focus aspects filter
        if (options?.focusAspects?.length) {
            const focusSet = new Set(options.focusAspects.map(a => a.toLowerCase()));
            aspects = aspects.filter(a => focusSet.has(a.split(':')[0].toLowerCase()));
        }
        const coveredAspects = findCoveredAspects(aspects, tests);
        const missingAspects = aspects.filter((a) => !coveredAspects.includes(a));
        const hasExplicitLink = testRelationships.some((rel) => rel.metadata?.code_intelligence !== true);
        const hasAstLink = testRelationships.length > 0 && !hasExplicitLink;
        const inferred = inferRequirementFromTests(tests, req, graph);
        const evidence = hasExplicitLink ? "explicit_relationship" : hasAstLink ? "ast_inference" : inferred ? "structural_inference" : "none";
        let coverageType = "none";
        if (hasExplicitLink && missingAspects.length === 0 && aspects.length > 0)
            coverageType = "full";
        else if (hasExplicitLink && coveredAspects.length > 0)
            coverageType = "partial";
        items.push({
            requirement_id: req.id,
            requirement_name: req.name,
            test_id: tests[0]?.id,
            test_name: tests[0]?.name,
            coverage_type: coverageType,
            covered_aspects: coveredAspects,
            missing_aspects: missingAspects,
            evidence,
        });
        if (coverageType !== "full") {
            gaps.push(`${req.name}: missing coverage for ${missingAspects.join(", ")}`);
        }
    }
    const allItems = items;
    const reportItems = options?.maxResults ? allItems.slice(0, options.maxResults) : allItems;
    const covered = allItems.filter((i) => i.coverage_type === "full").length;
    const partial = allItems.filter((i) => i.coverage_type === "partial").length;
    const uncovered = allItems.filter((i) => i.coverage_type === "none").length;
    return {
        items: reportItems,
        orphan_tests: orphanTests,
        total_requirements: requirements.length,
        covered_count: covered,
        partial_count: partial,
        uncovered_count: uncovered,
        coverage_rate: requirements.length === 0 ? 1 : covered / requirements.length,
        gaps,
    };
}
function inferRequirementFromTests(tests, requirement, graph) {
    const reqName = requirement.name.toLowerCase().replace(/\s+/g, "-");
    const reqId = requirement.id.toLowerCase();
    return tests.some((test) => {
        const metadata = test.metadata;
        const imports = Array.isArray(metadata.imports) ? metadata.imports.filter((value) => typeof value === "string") : [];
        const text = (String(test.id) + " " + String(test.name) + " " + String(metadata.target || "")).toLowerCase();
        return text.includes(reqName) || text.includes(reqId) || imports.some((item) => item.toLowerCase().includes(reqName)) ||
            graph.relationships.some((rel) => rel.from === requirement.id && rel.to === test.id && rel.type === "tested_by");
    });
}
/**
 * Suggest a requirement only from explicit implementation relationships.
 */
function inferRequirementFromTest(test, _requirements, graph) {
    // Only graph relationships are suitable as a suggestion. Names, filenames
    // and imports are intentionally not treated as requirement evidence.
    const testMeta = test.metadata;
    // Relationship-based inference
    // If test is a child of a file that implements a requirement
    if (testMeta.file_path) {
        const fileNodes = graph.nodes.filter(n => n.type === "file");
        for (const file of fileNodes) {
            const fileMeta = file.metadata;
            if (fileMeta.path === testMeta.file_path) {
                // Find what this file implements
                const implementsRels = graph.relationships.filter(r => r.from === file.id && r.type === "implements");
                for (const rel of implementsRels) {
                    // Check if the target is a requirement or feature containing requirements
                    const target = graph.nodes.find(n => n.id === rel.to);
                    if (target?.type === "requirement") {
                        return { requirement_id: target.id, method: "file_relationship" };
                    }
                    if (target?.type === "feature") {
                        // Find requirements contained by this feature
                        const reqRels = graph.relationships.filter(r => r.from === target.id && r.type === "contains");
                        for (const reqRel of reqRels) {
                            const reqNode = graph.nodes.find(n => n.id === reqRel.to);
                            if (reqNode?.type === "requirement") {
                                return { requirement_id: reqNode.id, method: "feature_relationship" };
                            }
                        }
                    }
                }
            }
        }
    }
    return null;
}
function extractAspects(req) {
    const aspects = [];
    if (req.metadata.priority)
        aspects.push(`priority:${req.metadata.priority}`);
    const desc = (req.description || "").toLowerCase();
    if (desc.includes("validation"))
        aspects.push("validation");
    if (desc.includes("error"))
        aspects.push("error_handling");
    if (desc.includes("performance"))
        aspects.push("performance");
    if (desc.includes("security"))
        aspects.push("security");
    if (aspects.length === 0)
        aspects.push("behavior");
    return [...new Set(aspects)];
}
function findCoveredAspects(aspects, tests) {
    const covered = [];
    for (const aspect of aspects) {
        const isCovered = tests.some((test) => {
            const aspectKey = aspect.split(":")[0].toLowerCase();
            const metadata = test.metadata;
            const declared = [
                ...(Array.isArray(metadata.covered_aspects) ? metadata.covered_aspects : []),
                ...(Array.isArray(metadata.verifies) ? metadata.verifies : []),
            ].filter((value) => typeof value === "string").map((value) => value.toLowerCase());
            // A linked test proves generic behavior, while specialized claims must
            // be declared as structured evidence instead of inferred from names.
            if (aspectKey === "behavior")
                return true;
            return declared.some((value) => value === aspectKey || value === aspect.toLowerCase());
        });
        if (isCovered)
            covered.push(aspect);
    }
    return covered;
}
export function formatCoverageReport(report) {
    const ratePercent = (report.coverage_rate * 100).toFixed(1);
    const lines = [
        `## Test Coverage: ${ratePercent}%`,
        `Covered: ${report.covered_count} | Partial: ${report.partial_count} | Uncovered: ${report.uncovered_count}`,
        "",
    ];
    const grouped = {
        full: report.items.filter((i) => i.coverage_type === "full"),
        partial: report.items.filter((i) => i.coverage_type === "partial"),
        none: report.items.filter((i) => i.coverage_type === "none"),
    };
    if (grouped.none.length > 0) {
        lines.push("### ❌ Uncovered Requirements");
        for (const item of grouped.none) {
            lines.push(`- **${item.requirement_name}**: ${item.missing_aspects.join(", ")}`);
        }
        lines.push("");
    }
    if (grouped.partial.length > 0) {
        lines.push("### ⚠️ Partially Covered");
        for (const item of grouped.partial) {
            lines.push(`- **${item.requirement_name}**: missing ${item.missing_aspects.join(", ")}`);
        }
        lines.push("");
    }
    if (grouped.full.length > 0) {
        lines.push(`### ✅ Fully Covered (${grouped.full.length})`);
        for (const item of grouped.full) {
            lines.push(`- ${item.requirement_name} → ${item.test_name}`);
        }
        lines.push("");
    }
    if (report.gaps.length > 0) {
        lines.push("### Coverage Gaps");
        for (const gap of report.gaps) {
            lines.push(`- ${gap}`);
        }
    }
    if (report.orphan_tests.length > 0) {
        lines.push("");
        lines.push(`### 🧪 Tests Without Requirement Link (${report.orphan_tests.length})`);
        lines.push("These tests exist but are not linked to any requirement in the graph:");
        for (const test of report.orphan_tests.slice(0, 15)) {
            const pathInfo = test.test_path ? ` (${test.test_path})` : "";
            const inferredInfo = test.inferred_requirement_id
                ? ` → inferred: ${test.inferred_requirement_id} (${test.inferred_by})`
                : "";
            lines.push(`- **${test.test_name}**${pathInfo}${inferredInfo}`);
        }
        if (report.orphan_tests.length > 15) {
            lines.push(`- ... and ${report.orphan_tests.length - 15} more`);
        }
        lines.push("");
        lines.push("Use `sdd.add_relationship` to link: `from=requirement_id, to=test_id, type=tested_by`");
    }
    return lines.join("\n");
}
