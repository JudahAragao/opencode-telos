import { updateNode, getNodesByType, getNode } from "../graph/engine.js";
import { computeImpact } from "../graph/traverse.js";
import { createChange, classifyApprovalLevel } from "../changes/manager.js";
import { validateGraph } from "../validation/validator.js";
export function classifyChangeRequest(description) {
    const lower = description.toLowerCase();
    if (/adicionar|add|criar|create|nov[oa]/.test(lower)) {
        return { type: "add_functionality", description };
    }
    if (/modificar|modify|alterar|change|atualizar|update|editar|edit/.test(lower)) {
        return { type: "modify_functionality", description };
    }
    if (/deletar|delete|remover|remove|excluir|exclui/.test(lower)) {
        return { type: "delete_functionality", description };
    }
    if (/corrigir|fix|bug|erro|error/.test(lower)) {
        return { type: "bug_fix", description };
    }
    if (/refatorar|refactor|reorganizar|reorganize/.test(lower)) {
        return { type: "refactor", description };
    }
    if (/migrar|migrate|trocar|replace|substituir|banco|database|auth|autenticação/.test(lower)) {
        return { type: "architecture_change", description };
    }
    return { type: "modify_functionality", description };
}
export function enforceSddFirst(graph, request, options) {
    const result = {
        allowed: false,
        reason: "",
        validation_passed: false,
        sdd_updated: false,
        blocking_reasons: [],
    };
    // Step 1: Check if SDD is initialized
    if (!graph.nodes.some((n) => n.type === "project")) {
        result.reason = "SDD not initialized. Run sdd.initialize first.";
        result.blocking_reasons = ["No project node in graph"];
        return result;
    }
    // Step 2: Check if graph has enough specification
    const entities = getNodesByType(graph, "entity");
    const features = getNodesByType(graph, "feature");
    if (entities.length === 0 && features.length === 0) {
        result.reason = "SDD has no specification. Create features and entities before implementing.";
        result.blocking_reasons = ["No entities or features defined"];
        return result;
    }
    // Step 3: For delete/modify, check if target exists
    if (request.type === "delete_functionality" || request.type === "modify_functionality") {
        const found = graph.nodes.filter((n) => {
            const nameMatch = request.description.toLowerCase().includes(n.name.toLowerCase());
            const idMatch = request.description.toLowerCase().includes(n.id.toLowerCase());
            return nameMatch || idMatch;
        });
        if (found.length === 0 && request.type === "delete_functionality") {
            result.reason = `Cannot delete: no matching node found for "${request.description}". Specify the exact entity/feature name.`;
            result.blocking_reasons = ["Target not found in SDD"];
            return result;
        }
    }
    // Step 4: Classify approval level
    const proposal = {
        title: request.description,
        reason: request.description,
        affected_node_ids: request.affected_entities || [],
        new_nodes: [],
        modified_nodes: [],
        removed_node_ids: [],
        affected_files: request.affected_files || [],
        affected_tests: [],
        implementation_tasks: [],
    };
    let approvalLevel = options?.forceApprovalLevel || classifyApprovalLevel(proposal, graph);
    // Step 4b: Upgrade approval for cross-layer changes
    if (approvalLevel !== "BLOCKED" && !options?.forceApprovalLevel && request.affected_files && request.affected_files.length > 0) {
        const crossLayerDetected = detectCrossLayerChange(request.affected_files, graph);
        if (crossLayerDetected) {
            if (approvalLevel === "AUTO")
                approvalLevel = "REVIEW";
            else if (approvalLevel === "REVIEW")
                approvalLevel = "APPROVAL";
        }
    }
    // Step 5: Architecture changes need explicit approval
    if (request.type === "architecture_change" || approvalLevel === "BLOCKED") {
        result.reason = `This change requires explicit approval. Level: ${approvalLevel}. Description: ${request.description}`;
        result.blocking_reasons = [
            `Approval level: ${approvalLevel}`,
            "Architecture changes require human confirmation",
        ];
        return result;
    }
    // Step 6: Create the change node
    let changeNode;
    try {
        changeNode = createChange(graph, proposal);
        result.change_id = changeNode.id;
    }
    catch (e) {
        result.reason = `Failed to create change: ${e}`;
        return result;
    }
    // Step 7: Validate SDD
    if (options?.skipValidation) {
        result.validation_passed = true; // Assume valid if skipped
    }
    else {
        // Check validation cache
        let validation;
        const graphVersion = graph.metadata.updated_at;
        const cachedValidation = options?.validationCache?.get(graphVersion);
        const cacheMaxAge = 60000; // 1 minute
        if (cachedValidation && (Date.now() - cachedValidation.timestamp) < cacheMaxAge) {
            validation = cachedValidation;
        }
        else {
            validation = validateGraph(graph, undefined, options?.projectDir);
            if (options?.validationCache) {
                options.validationCache.set(graphVersion, { ...validation, timestamp: Date.now() });
            }
        }
        result.validation_passed = validation.valid;
        if (!validation.valid) {
            result.reason = `SDD validation failed with ${validation.errors.length} errors. Fix specification before implementing.`;
            result.blocking_reasons = validation.errors.map((e) => `[${e.code}] ${e.message}`);
            updateNode(graph, changeNode.id, { status: "BLOCKED" });
            return result;
        }
    }
    // Step 7b: Test-before-merge check for APPROVAL-level changes
    if (approvalLevel === "APPROVAL") {
        const affectedReqs = request.affected_entities || [];
        const hasTestCoverage = checkTestCoverageForAffected(graph, affectedReqs);
        if (!hasTestCoverage && affectedReqs.length > 0) {
            result.blocking_reasons = result.blocking_reasons || [];
            result.blocking_reasons.push(`APPROVAL-level change affects ${affectedReqs.length} entity(ies) but none have test coverage. ` +
                `Add test nodes and link them with 'tested_by' relationships before proceeding.`);
        }
    }
    // Step 8: Compute impact
    if (!options?.skipImpactAnalysis && request.affected_entities && request.affected_entities.length > 0) {
        const impactNodes = new Set();
        const maxDepth = options?.maxImpactDepth ?? 3;
        for (const entityId of request.affected_entities) {
            const impact = computeImpact(graph, entityId, maxDepth);
            for (const n of impact.direct)
                impactNodes.add(n.id);
            for (const n of impact.indirect)
                impactNodes.add(n.id);
        }
        result.impact_summary = `Impact: ${impactNodes.size} nodes affected`;
    }
    else if (options?.skipImpactAnalysis) {
        result.impact_summary = "Impact analysis skipped";
    }
    // Step 9: All checks passed. AUTO changes may proceed immediately; REVIEW
    // and APPROVAL changes remain draft until an explicit approval tool call.
    result.allowed = true;
    result.reason = approvalLevel === "AUTO"
        ? `SDD-first workflow: Change ${changeNode.id} created and approved automatically. Proceed with implementation.`
        : `SDD-first workflow: Change ${changeNode.id} created and validated. Explicit approval is required before implementation.`;
    result.sdd_updated = true;
    if (approvalLevel === "AUTO")
        updateNode(graph, changeNode.id, { status: "APPROVED" });
    return result;
}
/**
 * Detect if a change affects files across different architecture layers
 * (e.g., frontend files + backend files).
 */
function detectCrossLayerChange(files, _graph) {
    let hasFrontend = false;
    let hasBackend = false;
    let hasDatabase = false;
    for (const file of files) {
        const path = file.toLowerCase();
        if (path.includes("client") || path.includes("frontend") || path.includes("pages/") || path.includes("components/")) {
            hasFrontend = true;
        }
        else if (path.includes("server") || path.includes("backend") || path.includes("routes/") || path.includes("controllers/") || path.includes("services/") || path.includes("repositories/")) {
            hasBackend = true;
        }
        else if (path.includes("database") || path.includes("migrations/") || path.includes("schema")) {
            hasDatabase = true;
        }
    }
    // Cross-layer if frontend+backend or frontend+database
    return (hasFrontend && hasBackend) || (hasFrontend && hasDatabase) || (hasBackend && hasDatabase);
}
/**
 * Check if affected entities have test coverage.
 * Returns true if at least one entity has a test linked via 'tested_by'.
 */
function checkTestCoverageForAffected(graph, affectedEntities) {
    if (affectedEntities.length === 0)
        return true;
    for (const entityName of affectedEntities) {
        // Find entity node by name or ID
        const entity = graph.nodes.find((n) => (n.type === "entity" || n.type === "requirement" || n.type === "feature") &&
            (n.id === entityName || n.name.toLowerCase() === entityName.toLowerCase()));
        if (!entity)
            continue;
        // Check if this entity has any test linked
        const hasTest = graph.relationships.some((r) => r.from === entity.id && r.type === "tested_by");
        if (!hasTest)
            return false;
    }
    return true;
}
export function buildEnforcementPrompt(request, result) {
    const lines = [
        "## SDD Enforcement Status\n",
        `**Request Type:** ${request.type}`,
        `**Description:** ${request.description}`,
        `**Allowed:** ${result.allowed ? "YES" : "NO"}`,
        `**Change ID:** ${result.change_id || "N/A"}`,
        `**Validation:** ${result.validation_passed ? "PASSED" : "FAILED"}`,
        `**SDD Updated:** ${result.sdd_updated ? "YES" : "NO"}`,
    ];
    if (result.impact_summary) {
        lines.push(`\n**Impact:** ${result.impact_summary}`);
    }
    if (result.blocking_reasons && result.blocking_reasons.length > 0) {
        lines.push("\n### Blocking Reasons");
        for (const reason of result.blocking_reasons) {
            lines.push(`- ${reason}`);
        }
    }
    if (result.allowed) {
        lines.push("\n### Next Steps");
        lines.push("1. Update the SDD specification with the changes");
        lines.push("2. Validate the updated SDD");
        lines.push("3. Implement the code changes");
        lines.push("4. Run tests");
        lines.push("5. Verify implementation against SDD");
        lines.push("6. Update the Knowledge Graph");
        lines.push(`7. Complete change ${result.change_id}`);
    }
    else {
        lines.push("\n### Action Required");
        lines.push("The SDD must be updated before code changes can proceed.");
        lines.push("Use the discovery process to gather missing information.");
    }
    return lines.join("\n");
}
/**
 * Smart batch enforcement: for AUTO-level changes, execute the full cycle
 * (create change → validate → approve) in one call without user interaction.
 */
export function enforceSmartBatch(graph, request, affectedEntities = [], affectedFiles = [], options) {
    // Share validation cache between enforceSddFirst and the post-check
    // to avoid running validateGraph() twice
    const sharedValidationCache = options?.validationCache ?? new Map();
    const sharedOptions = { ...options, validationCache: sharedValidationCache };
    const result = enforceSddFirst(graph, {
        ...request,
        affected_entities: affectedEntities,
        affected_files: affectedFiles,
    }, sharedOptions);
    // If the change was auto-approved, reuse the cached validation result
    if (result.allowed && result.change_id) {
        const graphVersion = graph.metadata.updated_at;
        const cachedValidation = sharedValidationCache.get(graphVersion);
        const validation = cachedValidation || validateGraph(graph, undefined, options?.projectDir);
        const change = result.change_id ? getNode(graph, result.change_id) : undefined;
        if (validation.valid && change?.status === "APPROVED") {
            return { ...result, auto_completed: true };
        }
        else {
            return {
                ...result,
                auto_completed: false,
                reason: `Change created but validation failed: ${validation.errors.length} error(s). Fix spec before implementing.`,
            };
        }
    }
    return { ...result, auto_completed: false };
}
export function getSddEnforcementRules() {
    return `
## SDD-FIRST ENFORCEMENT RULES (MANDATORY)

You are operating under STRICT Spec-Driven Development enforcement.

### Rule 1: SDD is always first
Before ANY code modification:
- If SDD is not initialized: run sdd.initialize
- If specification is incomplete: run sdd.discover and complete it
- If specification exists: validate it with sdd.validate

### Rule 2: Every change must go through SDD
When the user requests ANY change:
1. Classify the change (add/modify/delete/bug_fix/refactor/architecture)
2. Create a Change node with sdd.create_change
3. Perform impact analysis with sdd.analyze_impact
4. Update the specification BEFORE writing code
5. Validate the updated specification
6. Only THEN implement the code
7. After implementation, validate again
8. Complete the change with sdd.complete_change

### Rule 3: Never skip SDD for "simple" changes
Even small changes must update the specification.
A "typo fix" in a field name is a specification change.
Renaming a variable that appears in the API is a specification change.

### Rule 4: Specification validation is mandatory
After EVERY specification update:
- Run sdd.validate
- If validation fails: fix the specification
- Only proceed to implementation after validation passes

### Rule 5: Code must match specification
After implementation:
- Run sdd.detect_drift
- If drift detected: reconcile specification and code
- The specification is always the source of truth

### Rule 6: Changes must be traceable
Every change must have:
- A Change node in the graph
- Affected nodes identified
- Impact analysis performed
- Validation before and after implementation

### Rule 7: Architecture changes need approval
Any change to:
- Database engine
- Authentication mechanism
- Multi-tenancy model
- API public contract
- Core business rules
Requires explicit user approval before implementation.

### Rule 8: Discovery is mandatory for new areas
When the user requests a new feature/area:
- Check if SDD has enough information
- If not: run sdd.discover
- Never assume implementation details
- Ask for missing information
- Update SDD before implementing

### Rule 9: Shell commands cannot bypass enforcement
Using shell commands to write source files is PROHIBITED without SDD approval:
- python3 heredocs (python3 - <<'EOF' ... open('file','w') ... EOF)
- python3 -c with open().write()
- node -e with fs.writeFileSync()
- Shell redirects (> file.ts, >> file.ts)
- cat >, tee, sed -i on source files
- ANY command that creates or modifies .ts, .tsx, .js, .py, .go, .rs files

All shell commands are monitored. The ONLY acceptable way to write code:
sdd.enforce → sdd.update_from_answers → sdd.approve_change → Write/Edit tools

### Enforcement Summary
The workflow is ALWAYS:
UNDERSTAND → MODEL → SPECIFY → ANALYZE IMPACT → APPROVE → PLAN → IMPLEMENT → TEST → VERIFY → SYNC

NEVER: IMPLEMENT → DOCUMENT
NEVER: Use shell commands to bypass SDD

### Shell Command Monitoring
All run_terminal_command calls are analyzed. Commands writing source files:
- BLOCKED if no SDD Change node covers the target files
- ALLOWED only after sdd.enforce → sdd.approve_change
- Logged in audit trail regardless of outcome
`;
}
