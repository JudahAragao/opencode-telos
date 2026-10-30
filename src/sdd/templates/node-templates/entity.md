---
id: "{{NODE_ID}}"
type: "entity"
name: "{{NAME}}"
status: "DRAFT"
version: 1
created_at: "{{CREATED_AT}}"
updated_at: "{{UPDATED_AT}}"
graph_version: "1.0.0"
md_path: ".sdd/docs/{{NODE_ID}}.md"
---

# Entity: {{NAME}}

## Fields
| Field Name | Type | Required | Unique | Description |
|------------|------|----------|--------|-------------|
| id | string | Yes | Yes | Primary identifier |
{{#each FIELDS}}
| {{name}} | {{type}} | {{#if required}}Yes{{else}}No{{/if}} | {{#if unique}}Yes{{else}}No{{/if}} | {{description}} |
{{/each}}
| created_at | Date | Yes | No | Creation timestamp |
| updated_at | Date | Yes | No | Last update timestamp |

## Relationships
- **{{REL_1_TYPE}}** → `{{REL_1_TARGET}}` ({{REL_1_TARGET_ID}})
- **{{REL_2_TYPE}}** → `{{REL_2_TARGET}}` ({{REL_2_TARGET_ID}})

## Business Rules
- **BR-001**: {{BR_001}}
- **BR-002**: {{BR_002}}

## Indexes
- Primary Key: `id`
- Unique: `{{UNIQUE_FIELD}}`
- Index: `{{INDEX_FIELD}}`

## Implementation Notes
{{IMPLEMENTATION_NOTES}}

## History
| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1 | {{CREATED_AT}} | System | Initial creation |