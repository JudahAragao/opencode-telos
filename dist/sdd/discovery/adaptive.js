import { getNodesByType } from "../graph/engine.js";
/**
 * Given a list of discovery questions and the current graph state,
 * filter out questions that are already answered by existing graph data.
 * This prevents redundant questions in brownfield projects.
 */
export function filterAlreadyAnswered(questions, graph) {
    const existingFeatures = getNodesByType(graph, "feature");
    const existingEntities = getNodesByType(graph, "entity");
    const existingEndpoints = getNodesByType(graph, "endpoint");
    const existingArch = getNodesByType(graph, "architecture_component");
    const existingDb = getNodesByType(graph, "database");
    const existingRules = getNodesByType(graph, "business_rule");
    // Build sets of existing info
    const existingTechStack = new Set();
    for (const arch of existingArch) {
        const tech = arch.metadata.technology;
        if (tech)
            existingTechStack.add(tech.toLowerCase());
    }
    for (const db of existingDb) {
        const engine = db.metadata.engine;
        if (engine)
            existingTechStack.add(engine.toLowerCase());
    }
    const existingEntityNames = new Set(existingEntities.map(e => e.name.toLowerCase()));
    const existingFeatureNames = new Set(existingFeatures.map(f => f.name.toLowerCase()));
    return questions.filter(q => {
        const headerLower = q.header.toLowerCase();
        // Skip framework questions if we already have architecture components
        if ((headerLower.includes("framework") || headerLower.includes("tech") || headerLower.includes("stack")) &&
            existingTechStack.size > 0) {
            return false;
        }
        // Skip database questions if we already have database nodes
        if ((headerLower.includes("database") || headerLower.includes("banco")) &&
            existingDb.length > 0) {
            return false;
        }
        // Skip entity questions if entities already exist
        if ((headerLower.includes("entidade") || headerLower.includes("entity") || headerLower.includes("modelo")) &&
            existingEntities.length > 2) {
            return false;
        }
        // Skip feature questions if features already exist
        if ((headerLower.includes("feature") || headerLower.includes("funcionalidade")) &&
            existingFeatures.length > 2) {
            return false;
        }
        // Skip API questions if endpoints already exist
        if ((headerLower.includes("api") || headerLower.includes("endpoint") || headerLower.includes("rota")) &&
            existingEndpoints.length > 2) {
            return false;
        }
        // Skip business rule questions if rules already exist
        if ((headerLower.includes("regra") || headerLower.includes("rule") || headerLower.includes("negócio")) &&
            existingRules.length > 2) {
            return false;
        }
        // Check if specific options in the question are already covered
        if (q.options && q.options.length > 0) {
            const coveredOptions = q.options.filter(opt => {
                const optLower = opt.label.toLowerCase();
                return existingTechStack.has(optLower) ||
                    existingEntityNames.has(optLower) ||
                    existingFeatureNames.has(optLower);
            });
            // If most options are already covered, skip this question
            if (coveredOptions.length >= q.options.length * 0.5) {
                return false;
            }
        }
        return true;
    });
}
/**
 * Generate context-aware questions based on graph gaps.
 * Instead of generic questions, ask about what's actually missing.
 */
export function generateGapQuestions(graph) {
    const questions = [];
    // Check for requirements without acceptance criteria
    const reqs = getNodesByType(graph, "requirement");
    const reqsWithoutCriteria = reqs.filter(r => {
        const meta = r.metadata;
        return !meta.acceptance_criteria || meta.acceptance_criteria.length === 0;
    });
    if (reqsWithoutCriteria.length > 0 && reqsWithoutCriteria.length <= 5) {
        for (const req of reqsWithoutCriteria.slice(0, 3)) {
            questions.push({
                question: `What are the acceptance criteria for requirement "${req.name}"?`,
                header: `Acceptance Criteria: ${req.name}`,
                options: [
                    { label: "Functional test", description: "Verify the feature works as expected" },
                    { label: "Edge cases", description: "Handle error scenarios and boundary conditions" },
                    { label: "Performance", description: "Response time and resource usage targets" },
                    { label: "Security", description: "Authentication, authorization, data validation" },
                ],
                multiple: true,
            });
        }
    }
    // Check for features without requirements
    const features = getNodesByType(graph, "feature");
    const featuresWithoutReqs = features.filter(f => {
        return !graph.relationships.some(r => r.from === f.id && r.type === "contains" &&
            graph.nodes.some(n => n.id === r.to && n.type === "requirement"));
    });
    if (featuresWithoutReqs.length > 0 && featuresWithoutReqs.length <= 3) {
        for (const feature of featuresWithoutReqs.slice(0, 2)) {
            questions.push({
                question: `What are the specific requirements for feature "${feature.name}"?`,
                header: `Requirements: ${feature.name}`,
                options: [
                    { label: "CRUD operations", description: "Create, Read, Update, Delete" },
                    { label: "Search & filter", description: "Query with filters and pagination" },
                    { label: "Real-time", description: "WebSocket or SSE updates" },
                    { label: "Export", description: "PDF, CSV, or other export formats" },
                ],
                multiple: true,
            });
        }
    }
    // Check for entities without persistence
    const entities = getNodesByType(graph, "entity");
    const entitiesWithoutDb = entities.filter(e => {
        return !graph.relationships.some(r => r.from === e.id && r.type === "persists_to");
    });
    if (entitiesWithoutDb.length > 0) {
        questions.push({
            question: `Which database should the ${entitiesWithoutDb.length} entity(ies) (${entitiesWithoutDb.map(e => e.name).join(", ")}) persist to?`,
            header: "Database for entities",
            options: [
                { label: "PostgreSQL", description: "Relational, full-featured, JSON support" },
                { label: "SQLite", description: "Lightweight, file-based, good for development" },
                { label: "MongoDB", description: "Document-based, flexible schema" },
                { label: "MySQL", description: "Popular relational database" },
            ],
        });
    }
    return questions;
}
