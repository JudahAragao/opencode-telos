---
id: "{{NODE_ID}}"
type: "change"
name: "{{NAME}}"
status: "DRAFT"
version: 1
created_at: "{{CREATED_AT}}"
updated_at: "{{UPDATED_AT}}"
graph_version: "1.0.0"
md_path: ".sdd/docs/{{NODE_ID}}.md"
---

# Change: {{NAME}}

## Summary
{{DESCRIPTION}}

## Motivation
{{MOTIVATION}}

## Affected Components
### Nodes
- {{AFFECTED_NODE_1}} ({{AFFECTED_NODE_1_ID}})
- {{AFFECTED_NODE_2}} ({{AFFECTED_NODE_2_ID}})

### Relationships
- {{AFFECTED_REL_1}} ({{AFFECTED_REL_1_ID}})
- {{AFFECTED_REL_2}} ({{AFFECTED_REL_2_ID}})

### Files
- `{{AFFECTED_FILE_1}}`
- `{{AFFECTED_FILE_2}}`

### Tests
- {{AFFECTED_TEST_1}} ({{AFFECTED_TEST_1_ID}})
- {{AFFECTED_TEST_2}} ({{AFFECTED_TEST_2_ID}})

## New Nodes
- {{NEW_NODE_1}} ({{NEW_NODE_1_ID}})
- {{NEW_NODE_2}} ({{NEW_NODE_2_ID}})

## Removed Nodes
- {{REMOVED_NODE_1}} ({{REMOVED_NODE_1_ID}})

## Modified Nodes
- {{MODIFIED_NODE_1}} ({{MODIFIED_NODE_1_ID}})
- {{MODIFIED_NODE_2}} ({{MODIFIED_NODE_2_ID}})

## Migration Plan
1. {{MIGRATION_STEP_1}}
2. {{MIGRATION_STEP_2}}
3. {{MIGRATION_STEP_3}}

## Rollback Plan
1. {{ROLLBACK_STEP_1}}
2. {{ROLLBACK_STEP_2}}

## Testing Strategy
- Unit tests: {{UNIT_TEST_COVERAGE}}
- Integration tests: {{INTEGRATION_TEST_COVERAGE}}
- E2E tests: {{E2E_TEST_COVERAGE}}

## Approval Level
{{APPROVAL_LEVEL}}

## No Requirement Impact
{{NO_REQUIREMENT_IMPACT}}

## History
| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1 | {{CREATED_AT}} | System | Initial creation |