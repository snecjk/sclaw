import {
  codeDeployStatusLabel,
  formatCodeDeployFailurePrompt,
  isCodeDeploySuccess,
  isCodeDeployTerminal,
  pickCodeDeployFields,
  type CodeDeployRecordFields,
} from '../../shared/code-deploy-status';
import {
  deployStoApp,
  refreshStoAppDeploy,
  type CodeDeployEnv,
} from './app-dev-api';

export type StoAppDeployOutcome =
  | {
      kind: 'success';
      fields: CodeDeployRecordFields;
      data: unknown;
    }
  | {
      kind: 'failed';
      fields: CodeDeployRecordFields;
      prompt: string;
      data: unknown;
    }
  | {
      kind: 'timeout';
      fields: CodeDeployRecordFields;
      data: unknown;
    };

const DEFAULT_POLL_INTERVAL_MS = 4_000;
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function pollDeployUntilTerminal(
  deploymentId: string,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
    workspaceId?: string;
    appCode?: string;
    onProgress?: (fields: CodeDeployRecordFields) => void;
    initialData?: unknown;
  },
): Promise<StoAppDeployOutcome> {
  const intervalMs = options?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const startedAt = Date.now();
  let latestData = options?.initialData;
  let latestFields: CodeDeployRecordFields = {
    ...pickCodeDeployFields(latestData),
    deploymentId:
      pickCodeDeployFields(latestData).deploymentId ?? deploymentId,
  };

  options?.onProgress?.(latestFields);

  const toOutcome = (fields: CodeDeployRecordFields, data: unknown): StoAppDeployOutcome => {
    if (isCodeDeploySuccess(fields.status)) {
      return { kind: 'success', fields, data: data ?? null };
    }
    return {
      kind: 'failed',
      fields,
      prompt: formatCodeDeployFailurePrompt(fields),
      data: data ?? null,
    };
  };

  if (isCodeDeployTerminal(latestFields.status)) {
    return toOutcome(latestFields, latestData);
  }

  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs);
    const refreshed = await refreshStoAppDeploy({
      deploymentId,
      workspaceId: options?.workspaceId,
      appCode: options?.appCode,
    });
    latestData = refreshed.data;
    latestFields = {
      ...latestFields,
      ...pickCodeDeployFields(latestData),
      deploymentId:
        pickCodeDeployFields(latestData).deploymentId
        ?? latestFields.deploymentId
        ?? deploymentId,
    };
    options?.onProgress?.(latestFields);

    if (!isCodeDeployTerminal(latestFields.status)) continue;
    return toOutcome(latestFields, latestData);
  }

  return {
    kind: 'timeout',
    fields: latestFields,
    data: latestData ?? null,
  };
}

/**
 * Push (via deploy API) → create deploy → poll refresh until terminal status.
 */
export async function runStoAppDeployFlow(input: {
  workspaceId: string;
  env: CodeDeployEnv;
  appCode?: string;
  deploymentVersion?: string;
  appName?: string;
  onProgress?: (progress: {
    phase: 'pushing' | 'creating' | 'polling';
    label: string;
    fields: CodeDeployRecordFields;
  }) => void;
}): Promise<StoAppDeployOutcome> {
  const pushMessage = input.appName
    ? `发布前同步: ${input.appName} (${input.env})`
    : `发布前同步 (${input.env})`;

  input.onProgress?.({
    phase: 'pushing',
    label: '正在提交代码…',
    fields: { env: input.env, appCode: input.appCode },
  });
  const created = await deployStoApp({
    workspaceId: input.workspaceId,
    env: input.env,
    appCode: input.appCode,
    deploymentVersion: input.deploymentVersion,
    pushMessage,
  });

  const createdFields = pickCodeDeployFields(created.data);
  const deploymentId = createdFields.deploymentId;
  if (!deploymentId) {
    throw new Error('发布已发起，但未返回 deploymentId');
  }

  const initialFields: CodeDeployRecordFields = {
    ...createdFields,
    deploymentId,
    env: createdFields.env ?? input.env,
    appCode: createdFields.appCode ?? created.appCode ?? input.appCode,
  };
  input.onProgress?.({
    phase: 'polling',
    label: `发布进行中：${codeDeployStatusLabel(initialFields.status || 'CREATED')}`,
    fields: initialFields,
  });

  return pollDeployUntilTerminal(deploymentId, {
    workspaceId: input.workspaceId,
    appCode: initialFields.applicationId ?? input.appCode,
    initialData: created.data,
    onProgress: (fields) => {
      input.onProgress?.({
        phase: 'polling',
        label: `发布进行中：${codeDeployStatusLabel(fields.status)}`,
        fields,
      });
    },
  });
}

export function describeStoAppDeployOutcome(outcome: StoAppDeployOutcome): string {
  const { fields } = outcome;
  const id = fields.deploymentId ? ` · ${fields.deploymentId}` : '';
  if (outcome.kind === 'success') {
    return `发布成功（${fields.env || '-'}${id}）`;
  }
  if (outcome.kind === 'failed') {
    return `发布失败（${codeDeployStatusLabel(fields.status)}${id}）`;
  }
  return `发布超时，请稍后在部署记录中查看（${fields.status || '未知状态'}${id}）`;
}
