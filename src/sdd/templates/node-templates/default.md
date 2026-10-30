---
id: "{{NODE_ID}}"
type: "{{TYPE}}"
name: "{{NAME}}"
status: "DRAFT"
version: 1
created_at: "{{CREATED_AT}}"
updated_at: "{{UPDATED_AT}}"
graph_version: "1.0.0"
md_path: ".sdd/docs/{{NODE_ID}}.md"
---

# {{TYPE | capitalize}}: {{NAME}}

## Description
{{DESCRIPTION}}

## Details
<!-- Add detailed information about this {{TYPE | lowercase }} -->

## Related Nodes
- {{RELATED_NODE_1}} ({{RELATED_NODE_1_ID}})
- {{RELATED_NODE_2}} ({{RELATED_NODE_2_ID}})

## Implementation Files
- `{{IMPL_FILE_1}}` ({{IMPL_FILE_1_ID}})
- `{{IMPL_FILE_2}}` ({{IMPL_FILE_2_ID}})

## Tests
- `{{TEST_FILE_1}}` ({{TEST_FILE_1_ID}})
- `{{TEST_FILE_2}}` ({{TEST_FILE_2_ID}})

## History
| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1 | {{CREATED_AT}} | System | Initial creation |