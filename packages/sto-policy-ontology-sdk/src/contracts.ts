import Ajv from 'ajv';

import { StoPolicySdkError } from './errors';
import type { JsonSchema, PolicyAction, PolicyRequestMap } from './types';

export type PolicyActionDefinition = {
  method: 'GET' | 'POST';
  path: string;
  requestSchema: JsonSchema | null;
};

const nonEmptyString = { type: 'string', minLength: 1 } as const;
const identifier = { type: 'string', minLength: 1, maxLength: 256 } as const;
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

const whereItem = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'op'],
  properties: {
    key: identifier,
    op: {
      enum: [
        'eq', 'ne', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'between',
        'contains', 'is_null', 'is_not_null',
      ],
    },
    value: {},
  },
  allOf: [
    {
      if: {
        required: ['op'],
        properties: { op: { enum: ['is_null', 'is_not_null'] } },
      },
      then: { not: { required: ['value'] } },
      else: { required: ['value'] },
    },
  ],
};

const orderByItem = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'direction'],
  properties: {
    key: identifier,
    direction: { enum: ['asc', 'desc'] },
  },
};

const queryTime = {
  type: 'object',
  additionalProperties: false,
  required: ['dateDimension'],
  properties: {
    dateDimension: { type: 'string', minLength: 1, maxLength: 64 },
    latest: { enum: [true] },
    at: date,
    range: {
      type: 'object',
      additionalProperties: false,
      required: ['start'],
      properties: { start: date, end: date },
    },
  },
  oneOf: [
    { required: ['latest'] },
    { required: ['at'] },
    { required: ['range'] },
  ],
};

const sharedQueryProperties = {
  time: queryTime,
  select: {
    type: 'array',
    minItems: 1,
    items: identifier,
  },
  where: { type: 'array', items: whereItem },
  orderBy: { type: 'array', items: orderByItem },
  limit: { type: 'integer', minimum: 1, maximum: 100 },
  cursor: { type: 'string', minLength: 1, maxLength: 8192 },
  count: { enum: ['NONE', 'INCLUDE', 'ONLY'] },
};

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

const queryObjectSetSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'scope'],
  properties: {
    from: identifier,
    scope: {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['objectRef'],
          properties: { objectRef: { type: 'string', minLength: 1, maxLength: 2048 } },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['objectType', 'within'],
          properties: {
            objectType: identifier,
            within: { type: 'string', minLength: 1, maxLength: 2048 },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['objectType', 'all'],
          properties: { objectType: identifier, all: { enum: [true] } },
        },
      ],
    },
    ...sharedQueryProperties,
  },
};

const searchAroundSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'relation'],
  properties: {
    from: { type: 'string', minLength: 1, maxLength: 2048 },
    relation: identifier,
    ...sharedQueryProperties,
  },
};

export const POLICY_HTTP_ACTIONS: Readonly<Record<PolicyAction, PolicyActionDefinition>> =
  deepFreeze({
    discover: {
      method: 'POST',
      path: '/sto-policy/api/v1/cli/ontology/discover',
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['question'],
        properties: { question: { type: 'string', minLength: 1, maxLength: 2000 } },
      },
    },
    executefunction: {
      method: 'POST',
      path: '/sto-policy/api/v1/cli/ontology/execute-function',
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['functionRef', 'arguments'],
        properties: {
          functionRef: {
            type: 'string',
            pattern: '^[A-Za-z][A-Za-z0-9]*@\\d+\\.\\d+(?:\\.\\d+)?$',
          },
          arguments: { type: 'object' },
        },
      },
    },
    resolvereference: {
      method: 'POST',
      path: '/sto-policy/api/v1/cli/ontology/resolve-reference',
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['objectType', 'referenceText'],
        properties: {
          objectType: identifier,
          referenceText: { type: 'string', minLength: 1, maxLength: 1000 },
          page: {
            type: 'object',
            additionalProperties: false,
            properties: {
              limit: { type: 'integer', minimum: 1, maximum: 100 },
              cursor: nonEmptyString,
              includeTotalCount: { type: 'boolean' },
            },
          },
        },
      },
    },
    queryobjectset: {
      method: 'POST',
      path: '/sto-policy/api/v1/cli/ontology/query-object-set',
      requestSchema: queryObjectSetSchema,
    },
    searcharound: {
      method: 'POST',
      path: '/sto-policy/api/v1/cli/ontology/search-around',
      requestSchema: searchAroundSchema,
    },
    schema: {
      method: 'POST',
      path: '/sto-policy/api/v1/cli/ontology/schema',
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['target'],
        properties: {
          target: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'key'],
            properties: {
              kind: { enum: ['OBJECT_TYPE', 'LINK_TYPE'] },
              key: identifier,
            },
          },
          focus: {
            type: 'object',
            additionalProperties: false,
            required: ['metricKeys'],
            properties: {
              metricKeys: {
                type: 'array',
                minItems: 1,
                maxItems: 20,
                items: identifier,
              },
            },
          },
        },
      },
    },
    schemagraph: {
      method: 'GET',
      path: '/sto-policy/api/v1/cli/ontology/schema-graph',
      requestSchema: null,
    },
    describemetrictree: {
      method: 'POST',
      path: '/sto-policy/api/v1/cli/ontology/describe-metric-tree',
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', minLength: 2 },
          metricId: nonEmptyString,
          metricKey: { type: 'string', pattern: '^[A-Za-z0-9]+$' },
          metricKeys: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', pattern: '^[A-Za-z0-9]+$' },
          },
          entityType: nonEmptyString,
          ownerType: nonEmptyString,
          depth: { type: 'integer', minimum: 1, maximum: 4 },
          candidateLimit: { type: 'integer', minimum: 1, maximum: 20 },
          includeCandidates: { type: 'boolean' },
        },
        anyOf: [
          { required: ['query'] },
          { required: ['metricId'] },
          { required: ['metricKey'] },
          { required: ['metricKeys'] },
        ],
        allOf: [
          {
            if: { required: ['metricKeys'] },
            then: {
              not: {
                anyOf: [
                  { required: ['query'] },
                  { required: ['metricId'] },
                  { required: ['metricKey'] },
                ],
              },
            },
          },
        ],
      },
    },
    help: {
      method: 'POST',
      path: '/sto-policy/api/v1/cli/ontology/help',
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        maxProperties: 1,
        properties: {
          command: {
            enum: [
              'discover', 'execute-function', 'resolve-reference', 'resolve-references',
              'query-object-set', 'search-around', 'describe-metric-tree', 'schema',
              'schema-graph', 'help', 'tools', 'health', 'version',
            ],
          },
          errorCode: nonEmptyString,
          listErrors: { enum: [true] },
        },
      },
    },
  });

const requestAjv = new Ajv({ allErrors: true, jsonPointers: true });
type RequestValidator = ReturnType<typeof requestAjv.compile>;
const requestValidators = new Map<PolicyAction, RequestValidator>();

for (const [action, definition] of Object.entries(POLICY_HTTP_ACTIONS) as Array<
  [PolicyAction, PolicyActionDefinition]
>) {
  if (definition.requestSchema) {
    requestValidators.set(action, requestAjv.compile(definition.requestSchema));
  }
}

export function isPolicyAction(value: string): value is PolicyAction {
  return Object.prototype.hasOwnProperty.call(POLICY_HTTP_ACTIONS, value);
}

export function assertPolicyRequest<A extends PolicyAction>(
  action: A,
  input: PolicyRequestMap[A],
): void {
  if (action === 'schemagraph') {
    if (input !== undefined) {
      throw new StoPolicySdkError(
        'POLICY_PARAMETERS_INVALID',
        'schemagraph does not accept a request body',
      );
    }
    return;
  }

  const validator = requestValidators.get(action);
  if (!validator || !validator(input)) {
    throw new StoPolicySdkError(
      'POLICY_PARAMETERS_INVALID',
      `Invalid parameters for Policy action: ${action}`,
      { detail: validator?.errors ?? [] },
    );
  }
}
