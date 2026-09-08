import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import type { TObject, TSchema } from 'typebox';

type JsonSchema = TSchema & {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
  patternProperties?: Record<string, JsonSchema>;
  description?: string;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  minItems?: number;
  maxItems?: number;
};

export class UnsupportedSclawToolSchemaError extends Error {
  constructor(readonly schemaPath: string, message: string) {
    super(`${schemaPath}: ${message}`);
    this.name = 'UnsupportedSclawToolSchemaError';
  }
}

function withDescription(schema: JsonSchema, value: ZodTypeAny): ZodTypeAny {
  return schema.description ? value.describe(schema.description) : value;
}

function literalSchema(value: unknown, path: string): ZodTypeAny {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return z.literal(value as string | number | boolean | null);
  }
  throw new UnsupportedSclawToolSchemaError(path, 'only primitive literals are supported');
}

function stringSchema(schema: JsonSchema): ZodTypeAny {
  let result = z.string();
  if (schema.minLength != null) result = result.min(schema.minLength);
  if (schema.maxLength != null) result = result.max(schema.maxLength);
  if (schema.pattern) result = result.regex(new RegExp(schema.pattern));
  return result;
}

function numberSchema(schema: JsonSchema, integer: boolean): ZodTypeAny {
  let result = z.number();
  if (integer) result = result.int();
  if (schema.minimum != null) result = result.min(schema.minimum);
  if (schema.maximum != null) result = result.max(schema.maximum);
  if (schema.exclusiveMinimum != null) result = result.gt(schema.exclusiveMinimum);
  if (schema.exclusiveMaximum != null) result = result.lt(schema.exclusiveMaximum);
  return result;
}

function objectSchema(schema: JsonSchema, path: string): ZodTypeAny {
  if (!schema.properties) {
    const valueSchema = schema.additionalProperties && typeof schema.additionalProperties === 'object'
      ? typeBoxSchemaToZod(schema.additionalProperties, `${path}.additionalProperties`)
      : schema.patternProperties
        ? typeBoxSchemaToZod(
          Object.values(schema.patternProperties)[0] ?? {},
          `${path}.patternProperties`,
        )
        : z.unknown();
    return z.record(valueSchema);
  }

  const required = new Set(schema.required ?? []);
  const shape: ZodRawShape = {};
  for (const [key, property] of Object.entries(schema.properties)) {
    const converted = typeBoxSchemaToZod(property, `${path}.properties.${key}`);
    shape[key] = required.has(key) ? converted : converted.optional();
  }
  return schema.additionalProperties === false ? z.object(shape).strict() : z.object(shape);
}

export function typeBoxSchemaToZod(schemaValue: TSchema, path = '$'): ZodTypeAny {
  const schema = schemaValue as JsonSchema;
  let result: ZodTypeAny;

  if (Object.keys(schema).length === 0) {
    result = z.unknown();
  } else if (schema.const !== undefined) {
    result = literalSchema(schema.const, path);
  } else if (Array.isArray(schema.enum)) {
    const values = schema.enum;
    if (values.length === 0) throw new UnsupportedSclawToolSchemaError(path, 'enum cannot be empty');
    result = values.length === 1
      ? literalSchema(values[0], path)
      : z.union(values.map((value) => literalSchema(value, path)) as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
  } else if (schema.anyOf || schema.oneOf) {
    const variants = schema.anyOf ?? schema.oneOf ?? [];
    if (variants.length < 2) throw new UnsupportedSclawToolSchemaError(path, 'union requires at least two variants');
    result = z.union(
      variants.map((variant, index) => typeBoxSchemaToZod(variant, `${path}.union.${index}`)) as [
        ZodTypeAny,
        ZodTypeAny,
        ...ZodTypeAny[],
      ],
    );
  } else if (Array.isArray(schema.type)) {
    if (schema.type.length < 2) {
      result = typeBoxSchemaToZod({ ...schema, type: schema.type[0] } as JsonSchema, path);
    } else {
      result = z.union(schema.type.map((type) => typeBoxSchemaToZod({ ...schema, type } as JsonSchema, path)) as [
        ZodTypeAny,
        ZodTypeAny,
        ...ZodTypeAny[],
      ]);
    }
  } else {
    switch (schema.type) {
      case 'string': result = stringSchema(schema); break;
      case 'number': result = numberSchema(schema, false); break;
      case 'integer': result = numberSchema(schema, true); break;
      case 'boolean': result = z.boolean(); break;
      case 'null': result = z.null(); break;
      case 'array': {
        if (!schema.items) throw new UnsupportedSclawToolSchemaError(path, 'array items are required');
        let array = z.array(typeBoxSchemaToZod(schema.items, `${path}.items`));
        if (schema.minItems != null) array = array.min(schema.minItems);
        if (schema.maxItems != null) array = array.max(schema.maxItems);
        result = array;
        break;
      }
      case 'object': result = objectSchema(schema, path); break;
      default: throw new UnsupportedSclawToolSchemaError(path, `unsupported schema type ${String(schema.type)}`);
    }
  }

  if (schema.default !== undefined) result = result.default(schema.default);
  return withDescription(schema, result);
}

export function typeBoxObjectToZodRawShape(schema: TObject): ZodRawShape {
  const converted = typeBoxSchemaToZod(schema);
  if (!(converted instanceof z.ZodObject)) {
    throw new UnsupportedSclawToolSchemaError('$', 'tool parameters must be an object schema');
  }
  return converted.shape;
}
