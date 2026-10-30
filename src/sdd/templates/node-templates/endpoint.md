---
id: "{{NODE_ID}}"
type: "endpoint"
name: "{{NAME}}"
status: "DRAFT"
version: 1
created_at: "{{CREATED_AT}}"
updated_at: "{{UPDATED_AT}}"
graph_version: "1.0.0"
md_path: ".sdd/docs/{{NODE_ID}}.md"
---

# Endpoint: {{NAME}}

## HTTP Method & Path
`{{METHOD}} {{PATH}}`

## Description
{{DESCRIPTION}}

## Request

### Headers
| Header | Value | Required |
|--------|-------|----------|
| Content-Type | application/json | Yes |
| Authorization | Bearer {{TOKEN}} | Yes |

### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| {{QUERY_1}} | {{QUERY_1_TYPE}} | {{QUERY_1_REQUIRED}} | {{QUERY_1_DESC}} |

### Request Body
```json
{{REQUEST_BODY}}
```

## Response

### Success Response ({{SUCCESS_CODE}})
```json
{{SUCCESS_RESPONSE}}
```

### Error Responses
| Code | Condition | Response |
|------|-----------|----------|
| 400 | {{ERROR_400_CONDITION}} | {{ERROR_400_RESPONSE}} |
| 401 | {{ERROR_401_CONDITION}} | {{ERROR_401_RESPONSE}} |
| 404 | {{ERROR_404_CONDITION}} | {{ERROR_404_RESPONSE}} |
| 500 | {{ERROR_500_CONDITION}} | {{ERROR_500_RESPONSE}} |

## Authentication
- **Type**: {{AUTH_TYPE}}
- **Scopes**: {{AUTH_SCOPES}}

## Rate Limiting
- **Limit**: {{RATE_LIMIT}} requests per {{RATE_WINDOW}}
- **Scope**: {{RATE_SCOPE}}

## Operates On
- Entity: `{{OPERATES_ON_ENTITY}}` ({{OPERATES_ON_ENTITY_ID}})

## Related Requirements
- {{REQ_1}} ({{REQ_1_ID}})
- {{REQ_2}} ({{REQ_2_ID}})

## Implementation
- Controller: `{{CONTROLLER_PATH}}` ({{CONTROLLER_FILE_ID}})
- Service: `{{SERVICE_PATH}}` ({{SERVICE_FILE_ID}})
- Repository: `{{REPOSITORY_PATH}}` ({{REPOSITORY_FILE_ID}})

## Tests
- `tests/{{TEST_1}}.test.ts` ({{TEST_1_ID}})
- `tests/{{TEST_2}}.test.ts` ({{TEST_2_ID}})

## History
| Version | Date | Author | Change |
|---------|------|--------|--------|
| 1 | {{CREATED_AT}} | System | Initial creation |