/**
 * 工作流模版实例化辅助
 * 将工作流模版实例化为工作流实例，返回实例 id（workflowId）。
 * 启动参数 values 用 schema 字段默认值组装，没有默认值则空对象。
 * 仅创建实例，不启动、不做 SSE 追踪——定时任务由后端按调度执行。
 */

import { getStartupSchema, createWorkflow } from '@/lib/workflow-api';

export async function instantiateWorkflowFromTemplate(templateId: string): Promise<string> {
  const { schema, schemaHash } = await getStartupSchema(templateId);
  const values: Record<string, unknown> = {};
  for (const f of schema.fields ?? []) {
    if (f.defaultValue !== undefined && f.defaultValue !== null) {
      values[f.key] = f.defaultValue;
    }
  }
  const { buildStartupPreset } = await import('@/lib/workflow-form-utils');
  const created = await createWorkflow({
    templateId,
    startup: buildStartupPreset(values, schemaHash),
    idempotencyKey: `create-wf-${templateId}-${Date.now()}`,
  });
  return created.workflowId;
}
