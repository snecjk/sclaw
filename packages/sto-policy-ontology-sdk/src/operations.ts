import Ajv from 'ajv';

import { assertPolicyRequest, isPolicyAction } from './contracts';
import { StoPolicySdkError } from './errors';
import type {
  JsonObject,
  PolicyAction,
  PolicyOperation,
  PolicyRequestMap,
} from './types';

const OPERATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const MAX_OPERATION_ID_LENGTH = 128;

type CompiledOperation = {
  operation: PolicyOperation;
  validateParameters: OperationValidator;
};

type OperationValidator = {
  (data: unknown): boolean | PromiseLike<unknown>;
  errors?: readonly unknown[] | null;
};

function isPlainObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonObject(value: JsonObject): JsonObject {
  try {
    if (typeof globalThis.structuredClone === 'function') {
      return globalThis.structuredClone(value) as JsonObject;
    }
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    throw new StoPolicySdkError(
      'POLICY_PARAMETERS_INVALID',
      'Operation parameters must contain JSON-compatible values',
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function assertOperationId(operationId: string): void {
  if (
    operationId.length > MAX_OPERATION_ID_LENGTH ||
    !OPERATION_ID_PATTERN.test(operationId)
  ) {
    throw new StoPolicySdkError(
      'POLICY_OPERATION_INVALID',
      'operationId must use lowercase dot/dash notation and be at most 128 characters',
    );
  }
}

function assertParameterSchema(operation: PolicyOperation): void {
  const schema = operation.parameterSchema;
  if (
    !isPlainObject(schema) ||
    schema.type !== 'object' ||
    schema.additionalProperties !== false
  ) {
    throw new StoPolicySdkError(
      'POLICY_OPERATION_INVALID',
      `Operation ${operation.operationId} must use an object parameterSchema with additionalProperties=false`,
    );
  }
}

/** 定义阶段即冻结合同，避免应用运行后修改 Action 或请求构造逻辑。 */
export function definePolicyOperation<
  A extends PolicyAction,
  P extends Record<string, unknown>,
>(operation: PolicyOperation<A, P>): PolicyOperation<A, P> {
  return Object.freeze({ ...operation, parameterSchema: deepFreeze({ ...operation.parameterSchema }) });
}

export class PolicyOperationRegistry {
  private readonly operations = new Map<string, CompiledOperation>();

  constructor(operations: readonly PolicyOperation[] = []) {
    const ajv = new Ajv({ allErrors: true, jsonPointers: true });

    for (const operation of operations) {
      assertOperationId(operation.operationId);
      if (!isPolicyAction(String(operation.action))) {
        throw new StoPolicySdkError(
          'POLICY_ACTION_DENIED',
          `Operation ${operation.operationId} uses an unsupported Policy action`,
        );
      }
      assertParameterSchema(operation);
      if (this.operations.has(operation.operationId)) {
        throw new StoPolicySdkError(
          'POLICY_OPERATION_DUPLICATE',
          `Duplicate Policy operation: ${operation.operationId}`,
        );
      }

      let validateParameters: OperationValidator;
      try {
        validateParameters = ajv.compile(operation.parameterSchema);
      } catch {
        throw new StoPolicySdkError(
          'POLICY_OPERATION_INVALID',
          `Operation ${operation.operationId} has an invalid parameterSchema`,
        );
      }

      this.operations.set(operation.operationId, {
        operation: definePolicyOperation(operation),
        validateParameters,
      });
    }
  }

  buildRequest(operationId: string, parameters: JsonObject = {}): {
    action: PolicyAction;
    input: PolicyRequestMap[PolicyAction];
  } {
    const compiled = this.operations.get(operationId);
    if (!compiled) {
      throw new StoPolicySdkError(
        'POLICY_OPERATION_NOT_FOUND',
        `Policy operation not found: ${operationId}`,
      );
    }

    const safeParameters = deepFreeze(cloneJsonObject(parameters));
    if (!compiled.validateParameters(safeParameters)) {
      throw new StoPolicySdkError(
        'POLICY_PARAMETERS_INVALID',
        `Invalid parameters for Policy operation: ${operationId}`,
        { detail: compiled.validateParameters.errors ?? [] },
      );
    }

    let input: PolicyRequestMap[PolicyAction];
    try {
      input = compiled.operation.buildBody(safeParameters);
    } catch {
      throw new StoPolicySdkError(
        'POLICY_OPERATION_BUILD_FAILED',
        `Failed to build request for Policy operation: ${operationId}`,
      );
    }

    assertPolicyRequest(compiled.operation.action, input);
    return { action: compiled.operation.action, input };
  }
}
