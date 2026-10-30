---
id: "{{NODE_ID}}"
type: "requirement"
name: "{{NAME}}"
status: "DRAFT"
version: 1
created_at: "{{CREATED_AT}}"
updated_at: "{{UPDATED_AT}}"
graph_version: "1.0.0"
md_path: ".sdd/docs/{{NODE_ID}}.md"
---

# Requirement: {{NAME}}

## Description
{{DESCRIPTION}}

## Acceptance Criteria
- [ ] AC-001: {{AC_001}}
- [ ] AC-002: {{AC_002}}
- [ ] AC-003: {{AC_003}}

## Verification Scenarios
### Scenario 1: {{SCENARIO_1_NAME}}
- **Given**: {{SCENARIO_1_GIVEN}}
- **When**: {{SCENARIO_1_WHEN}}
- **Then**: {{SCENARIO_1_THEN}}

### Scenario 2: {{SCENARIO_2_NAME}}
- **Given**: {{SCENARIO_2_GIVEN}}
- **When**: {{SCENARIO_2_WHEN}}
- **Then**: {{SCENARIO_2_THEN}}

## API Contract
```json
{{API_CONTRACT}}
```

## Invariants
- {{INVARIANT_1}}
- {{INVARIANT_2}}

## Security Criteria
- {{SECURITY_1}}
- {{SECURITY_2}}

## Performance Criteria
- {{PERFORMANCE_1}}
- {{PERFORMANCE_2}}

## Related Features
- {{FEATURE_1}} ({{FEATURE_1_ID}})
- {{FEATURE_2}} ({{FEATURE_2_ID}})

## History
| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1 | {{CREATED_AT}} | System | Initial creation |