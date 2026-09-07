import { Type, type Static, type TObject } from 'typebox';
import {
  sclawToolFailure,
  type SclawToolDefinition,
  type SclawToolOutcome,
} from '../../../../shared/agent-extensions';
import { STO_WORKFLOW_MANAGEMENT_ACTIVATION } from './activation';
import { STO_WORKFLOW_CAPABILITY, type StoWorkflowPort } from './capability';

const MAX_PAGE_SIZE = 50;
const WORKFLOW_TEMPLATES_NO_ACCESS_MESSAGE =
  '未查询到可访问的工作流模板，您可能没有相关权限。请联系管理员申请工作流访问权限。';

async function run<T>(type: string, handler: () => Promise<T>): Promise<SclawToolOutcome<T>> {
  try {
    return { success: true, type, domain: 'workflow', data: await handler() };
  } catch (error) {
    return sclawToolFailure(
      'workflow',
      'sto_workflow_tool_error',
      error instanceof Error ? error.message : String(error),
    );
  }
}

function clampPageSize(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 10, 1), MAX_PAGE_SIZE);
}

async function searchTemplates(port: StoWorkflowPort, query: string, limit?: number) {
  const templates = await port.searchTemplates(query, clampPageSize(limit));
  if (!templates.length) {
    const suffix = query.trim() ? `（搜索：${query.trim()}）` : '';
    throw new Error(`${WORKFLOW_TEMPLATES_NO_ACCESS_MESSAGE}${suffix}`);
  }
  return templates;
}

async function resolveTemplate(
  port: StoWorkflowPort,
  input: { templateId?: string; query?: string },
): Promise<{ templateId: string; matchedLabel?: string; resolvedViaSearch: boolean }> {
  const templateId = input.templateId?.trim();
  if (templateId) return { templateId, resolvedViaSearch: false };
  const query = input.query?.trim();
  if (!query) throw new Error('Missing templateId or query. Search templates first or pass query.');
  const first = (await searchTemplates(port, query, 5))[0];
  if (!first?.id) throw new Error(`No workflow template matched: ${query}`);
  return { templateId: first.id, matchedLabel: first.label, resolvedViaSearch: true };
}

function tool<T extends TObject>(definition: SclawToolDefinition<T>): SclawToolDefinition<T> {
  return {
    ...definition,
    engines: ['claude', 'pi'],
    modes: ['interactive', 'scheduled'],
    activation: STO_WORKFLOW_MANAGEMENT_ACTIVATION,
  };
}

const searchSchema = Type.Object({
  query: Type.String({ minLength: 1, description: '搜索关键词或用户业务意图' }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE, description: '最大结果数，默认 10' })),
});

const schemaLookupSchema = Type.Object({
  templateId: Type.Optional(Type.String({ description: 'search_workflow_templates 返回的模板 id' })),
  query: Type.Optional(Type.String({ description: '未知 templateId 时用于搜索的用户意图' })),
});

const createSchema = Type.Object({
  templateId: Type.String({ minLength: 1 }),
  schemaHash: Type.String({ minLength: 1, description: 'get_workflow_schema 返回的 schemaHash' }),
  values: Type.Record(Type.String(), Type.Unknown(), { description: '用户确认后的启动参数' }),
  displayName: Type.Optional(Type.String()),
});

const executeSchema = Type.Object({
  workflowId: Type.String({ minLength: 1, description: '工作流实例 id，例如 wf_xxx' }),
  inputs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  templateName: Type.Optional(Type.String({ description: '用于 UI 卡片的工作流显示名称' })),
});

const statusSchema = Type.Object({
  runId: Type.String({ minLength: 1, description: '工作流运行 id' }),
});

export const stoWorkflowTools = [
  tool({
    name: 'search_workflow_templates',
    label: '搜索工作流模板',
    description: '按自然语言业务意图搜索可访问的 STO 工作流模板。',
    parameters: searchSchema,
    async execute(input: Static<typeof searchSchema>, context) {
      return run('workflow_templates_found', async () => {
        const templates = (await searchTemplates(
          context.capabilities.require(STO_WORKFLOW_CAPABILITY),
          input.query,
          input.limit,
        )).map((item) => ({ ...item, templateId: item.id }));
        return {
          query: input.query,
          templates,
          nextStep: templates[0]
            ? `Call get_workflow_schema with templateId="${templates[0].id}".`
            : 'No matching workflow template was found. Ask the user for a more specific description.',
        };
      });
    },
  }),
  tool({
    name: 'get_workflow_schema',
    label: '获取工作流参数表单',
    description: '获取模板启动参数 Schema；成功后本轮停止，让客户端展示表单。',
    parameters: schemaLookupSchema,
    async execute(input: Static<typeof schemaLookupSchema>, context) {
      return run('workflow_schema_ready', async () => {
        const port = context.capabilities.require(STO_WORKFLOW_CAPABILITY);
        const resolved = await resolveTemplate(port, input);
        context.logger.info('[agent-extension] workflow.schema.fetching', {
          extensionId: 'sto-workflow-tool',
          templateId: resolved.templateId,
          resolvedViaSearch: resolved.resolvedViaSearch,
        });
        const data = await port.getStartupSchema(resolved.templateId);
        context.logger.info('[agent-extension] workflow.schema.ready', {
          extensionId: 'sto-workflow-tool',
          templateId: data.templateId,
          schemaHash: data.schemaHash,
          fieldCount: data.schema?.fields?.length ?? 0,
          stepCount: data.schema?.steps?.length ?? 0,
        });
        return {
          templateId: data.templateId,
          schemaHash: data.schemaHash,
          schema: data.schema,
          templateName: resolved.matchedLabel,
          ...(resolved.resolvedViaSearch
            ? { resolvedViaSearch: true, matchedLabel: resolved.matchedLabel }
            : {}),
          nextStep: 'The client will render a parameter form. Ask the user to review and submit it.',
        };
      });
    },
  }),
  tool({
    name: 'create_workflow',
    label: '创建工作流',
    description: '使用用户明确确认的模板参数创建工作流实例。',
    parameters: createSchema,
    async execute(input: Static<typeof createSchema>, context) {
      return run('workflow_created', async () => {
        const created = await context.capabilities.require(STO_WORKFLOW_CAPABILITY).createWorkflow({
          ...input,
          idempotencyKey: `create-wf-${input.templateId}-${Date.now()}`,
        });
        return {
          workflowId: created.workflowId,
          workflowName: created.workflowName,
          templateId: input.templateId,
          schemaHash: created.schemaHash,
          values: input.values,
        };
      });
    },
  }),
  tool({
    name: 'execute_workflow',
    label: '执行工作流',
    description: '启动或重新运行一个已知 workflowId 的工作流实例。',
    parameters: executeSchema,
    async execute(input: Static<typeof executeSchema>, context) {
      return run('workflow_execution_started', async () => {
        const sessionKey = context.sessionKey.trim();
        if (!sessionKey) throw new Error('execute_workflow requires a chat sessionKey');
        const run = await context.capabilities.require(STO_WORKFLOW_CAPABILITY).startWorkflow({
          workflowId: input.workflowId,
          inputs: input.inputs ?? {},
          idempotencyKey: `start-wf-${input.workflowId}-${Date.now()}`,
          sessionKey,
          templateName: input.templateName,
          engineType: context.engine,
        });
        return {
          workflowId: run.workflowId ?? input.workflowId,
          runId: run.runId,
          status: run.status,
          templateName: input.templateName,
          startedAt: run.startedAt,
        };
      });
    },
  }),
  tool({
    name: 'get_workflow_status',
    label: '查询工作流状态',
    description: '查询一次工作流运行的状态、进度和结果。',
    parameters: statusSchema,
    async execute(input: Static<typeof statusSchema>, context) {
      return run('workflow_run_status', () => (
        context.capabilities.require(STO_WORKFLOW_CAPABILITY).getRun(input.runId)
      ));
    },
  }),
] as const;

export function isWorkflowShellCommand(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  if (!normalized) return false;
  if (/^dws\s+chat\s+message\s+send\b/u.test(normalized)) return false;
  return /\bworkflow\b|工作流/u.test(normalized)
    || /\bsai(?:-cli|_cli)?\s+(?:workflow|workflows)\b/u.test(normalized);
}
