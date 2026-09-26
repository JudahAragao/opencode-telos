/**
 * zod → JSON Schema conversion for the V2 tool registry.
 *
 * V2 tools declare `input` as JSON Schema (the V1 `tool()` helper used a zod
 * raw shape). Telos keeps zod as its single source of truth — the same schema
 * both documents the tool to the model and validates the arguments at
 * execution time — so this module derives the wire schema from it.
 *
 * The converter covers the subset of zod the Telos catalog actually uses
 * (verified by census: string, number, boolean, enum, array, optional, default)
 * and degrades to a permissive schema for anything else rather than emitting an
 * invalid document. A `tests/v2-sdk.test.ts` census test fails if a new tool
 * introduces a node kind that is not covered explicitly.
 */

/**
 * A zod schema, described structurally.
 *
 * The Telos catalog is authored with `tool.schema` from `@opencode-ai/plugin`,
 * which bundles its own zod v4, while other modules in this repo depend on
 * zod 3.25. The two have incompatible type identities but the same runtime
 * `_def` shape, so this module stays structural and version-agnostic instead of
 * binding to either.
 */
export type ZodSchemaLike = {
  _def?: Record<string, unknown>
  description?: string
  options?: unknown
  shape?: Record<string, ZodSchemaLike>
}

/** A JSON Schema fragment, kept loose because `effect`'s JsonSchema is wider. */
export type JsonSchema = Record<string, unknown>

/** String formats that map to a JSON Schema `format` keyword. */
const STRING_FORMATS: Record<string, string> = {
  email: "email",
  url: "uri",
  uuid: "uuid",
  guid: "uuid",
  ipv4: "ipv4",
  ipv6: "ipv6",
  date: "date",
  time: "time",
  datetime: "date-time",
}

/**
 * Node kinds this converter handles with a faithful schema.
 * The census test asserts the Telos catalog never leaves this set.
 */
export const SUPPORTED_ZOD_KINDS = [
  "string",
  "number",
  "boolean",
  "enum",
  "array",
  "optional",
  "default",
  "object",
  "record",
  "union",
  "literal",
  "null",
  "any",
  "unknown",
] as const

export type SupportedZodKind = (typeof SUPPORTED_ZOD_KINDS)[number]

/** True when `schema` is a zod type the converter maps exactly. */
export function isSupportedZodKind(schema: ZodSchemaLike): boolean {
  return (SUPPORTED_ZOD_KINDS as readonly string[]).includes(zodKind(schema))
}

/** zod 3.25 stores the node discriminator in `_def.type`; older in `typeName`. */
function zodKind(schema: ZodSchemaLike): string {
  const def = (schema as unknown as { _def?: { type?: string; typeName?: string } })._def
  return def?.type ?? def?.typeName ?? "unknown"
}

function stringChecks(checks: Set<string>): JsonSchema {
  const format = [...checks].map((check) => STRING_FORMATS[check]).find(Boolean)
  return format ? { type: "string", format } : { type: "string" }
}

/**
 * Convert a single zod type to a JSON Schema fragment.
 *
 * Wrappers (`optional`, `default`, `nullable`) unwrap to the inner schema and
 * report whether the field is required, which the object converter needs to
 * build a correct `required` array.
 */
export function zodToJsonSchema(schema: ZodSchemaLike): { json: JsonSchema; required: boolean } {
  const def = (schema as unknown as {
    _def?: Record<string, unknown>
    description?: string
  })._def ?? {}
  const kind = zodKind(schema)
  const description = (schema as unknown as { description?: string }).description

  let json: JsonSchema
  let required = true

  switch (kind) {
    case "string": {
      const checks = new Set<string>(
        (def.checks as Array<{ kind: string }> | undefined)?.map((check) => check.kind) ?? [],
      )
      json = stringChecks(checks)
      if (checks.has("min")) json.minLength = (def.minLength as { value: number }).value
      if (checks.has("max")) json.maxLength = (def.maxLength as { value: number }).value
      break
    }

    case "number":
    case "int": {
      json = { type: kind === "int" ? "integer" : "number" }
      break
    }

    case "boolean":
      json = { type: "boolean" }
      break

    case "nullish":
    case "null":
      json = { type: "null" }
      break

    case "literal": {
      const value = def.value
      json = { const: value, type: jsonTypeOf(value) }
      break
    }

    case "enum": {
      json = { type: "string", enum: enumValues(schema, def) }
      break
    }

    case "nativeEnum": {
      const values = Object.values(def.values as Record<string, string | number>)
      json = { enum: values }
      break
    }

    case "array": {
      const element = (def.element ?? def.type ?? def.valueType) as ZodSchemaLike | undefined
      json = {
        type: "array",
        items: element ? zodToJsonSchema(element).json : {},
      }
      break
    }

    case "object": {
      const shape = (schema as unknown as { shape: Record<string, ZodSchemaLike> }).shape
      json = objectShapeToJsonSchema(shape)
      break
    }

    case "record": {
      const valueType = (def.valueType ?? def.type) as ZodSchemaLike | undefined
      json = { type: "object", additionalProperties: valueType ? zodToJsonSchema(valueType).json : true }
      break
    }

    case "union": {
      const options = (def.options as ZodSchemaLike[] | undefined) ?? []
      json = { anyOf: options.map((option) => zodToJsonSchema(option).json) }
      break
    }

    case "optional":
    case "nullable":
    case "default":
    case "catch":
    case "readonly":
    case "prefault":
    case "nonoptional": {
      const inner = (def.innerType ?? def.type) as ZodSchemaLike | undefined
      if (!inner) {
        json = {}
        break
      }
      const converted = zodToJsonSchema(inner)
      json = converted.json
      // `optional`, `default` and `catch` all make the field omissible; a
      // `.default()` still lets the caller send nothing.
      required = kind === "nullable" || kind === "nonoptional" ? converted.required : false
      break
    }

    case "any":
    case "unknown":
      json = {}
      break

    default:
      // Unknown node: stay permissive so the tool remains callable.
      json = {}
      break
  }

  if (description) json.description = description
  return { json, required }
}

/**
 * Read the allowed values of a zod enum.
 *
 * zod 3.25 exposes them on the public `options` getter; the internal `_def`
 * moved from `values` (array) to `entries` (record), so both are handled.
 */
function enumValues(schema: ZodSchemaLike, def: Record<string, unknown>): string[] {
  const options = (schema as unknown as { options?: unknown }).options
  if (Array.isArray(options)) return options.map((value) => String(value))
  if (Array.isArray(def.values)) return (def.values as unknown[]).map((value) => String(value))
  if (def.entries && typeof def.entries === "object") {
    return Object.keys(def.entries as Record<string, unknown>)
  }
  return []
}

function jsonTypeOf(value: unknown): string {
  switch (typeof value) {
    case "string":
      return "string"
    case "number":
      return Number.isInteger(value) ? "integer" : "number"
    case "boolean":
      return "boolean"
    case "object":
      return value === null ? "null" : "object"
    default:
      return "string"
  }
}

/** Build the object schema for a zod raw shape, with an accurate `required`. */
export function objectShapeToJsonSchema(shape: Record<string, ZodSchemaLike>): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const [key, field] of Object.entries(shape)) {
    const { json, required: isRequired } = zodToJsonSchema(field)
    properties[key] = json
    if (isRequired) required.push(key)
  }

  const schema: JsonSchema = { type: "object", properties }
  if (required.length > 0) schema.required = required
  // Telos tools read unknown keys defensively; rejecting them would break
  // providers that echo back extra properties.
  schema.additionalProperties = false
  return schema
}

/**
 * Convert a V1 tool `args` raw shape into the JSON Schema V2 expects.
 *
 * This is the public entry point used by the V2 tool adapter.
 */
export function toolArgsToJsonSchema(shape: Record<string, ZodSchemaLike>): JsonSchema {
  return objectShapeToJsonSchema(shape)
}
