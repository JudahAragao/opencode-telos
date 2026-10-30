---
id: "{{NODE_ID}}"
type: "feature"
name: "{{NAME}}"
status: "DRAFT"
version: 1
created_at: "{{CREATED_AT}}"
updated_at: "{{UPDATED_AT}}"
graph_version: "1.0.0"
md_path: ".sdd/docs/{{NODE_ID}}.md"
---

# Feature: {{NAME}}

## Overview
{{DESCRIPTION}}

## Functional Requirements
- [ ] FR-001: {{FR_001}}
- [ ] FR-002: {{FR_002}}
- [ ] FR-003: {{FR_003}}

## Business Rules
- **BR-001**: {{BR_001}}
- **BR-002**: {{BR_002}}

## Entities Involved
- `{{ENTITY_1}}` ({{ENTITY_1_ID}})
- `{{ENTITY_2}}` ({{ENTITY_2_ID}})

## API Endpoints
- `{{METHOD_1}} {{PATH_1}}` ({{ENDPOINT_1_ID}})
- `{{METHOD_2}} {{PATH_2}}` ({{ENDPOINT_2_ID}})

## Architecture Decisions (ADRs)
- [{{ADR_1_ID}}]({{ADR_1_ID}}.md): {{ADR_1_TITLE}}
- [{{ADR_2_ID}}]({{ADR_2_ID}}.md): {{ADR_2_TITLE}}

## Acceptance Criteria
- [AC-001]({{AC_001_ID}}.md): {{AC_001_TEXT}}
- [AC-002]({{AC_002_ID}}.md): {{AC_002_TEXT}}

## Tests
- `tests/{{TEST_1}}.test.ts` ({{TEST_1_ID}})
- `tests/{{TEST_2}}.test.ts` ({{TEST_2_ID}})

## Implementation Files
- `src/{{IMPL_1}}` ({{FILE_1_ID}})
- `src/{{IMPL_2}}` ({{FILE_2_ID}})

## History
| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1 | {{CREATED_AT}} | System | Initial creation |