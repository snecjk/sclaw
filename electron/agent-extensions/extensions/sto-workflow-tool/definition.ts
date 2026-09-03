import type { SclawAgentExtensionDefinition } from '../../../../shared/agent-extensions';
import { matchesStoWorkflowIntent, STO_WORKFLOW_MANAGEMENT_ACTIVATION } from './activation';
import { STO_WORKFLOW_CAPABILITY } from './capability';
import { isWorkflowShellCommand, stoWorkflowTools } from './operations';

export const STO_WORKFLOW_SYSTEM_PROMPT = [
  'STO 工作流工具使用规则：',
  '',
  '【意图分流】',
  '- 用户仅查询、浏览或比较工作流模板时，只调用 search_workflow_templates，并向用户说明匹配结果；不要自动获取参数表单。',
  '- 用户明确要创建工作流时，先调用 search_workflow_templates。只有存在唯一且明确的匹配模板时，才使用其 templateId 调用 get_workflow_schema。',
  '- 搜索结果为空时，请用户补充业务需求；存在多个合理匹配时，请用户选择。禁止未经确认直接选择第一个结果。',
  '',
  '【创建工作流】',
  '- get_workflow_schema 成功后，客户端会渲染参数表单。本轮立即停止调用工作流工具，只告知用户检查并提交表单；同一轮禁止调用 create_workflow。',
  '- 只有收到用户或客户端明确提交并确认的表单值后，才能调用 create_workflow。必须原样使用本次表单对应的 templateId、schemaHash 和 values。',
  '- 禁止猜测、补写或擅自修改业务参数；缺少必填值时不得创建，也不得复用其他模板或旧表单的参数。',
  '- create_workflow 成功只表示已创建工作流实例，并不表示已经执行。保存返回的 workflowId；只有用户明确要求运行时才继续执行。',
  '',
  '【执行与查询】',
  '- execute_workflow 只接收已知的 workflowId，用于启动或重新运行工作流实例；不得把 templateId 或 runId 当作 workflowId。',
  '- execute_workflow 成功后保存其返回的 runId；使用 get_workflow_status(runId) 查询本次运行的进度和结果。',
  '- 需要等待最终结果时，可以查询至 completed、failed 或 cancelled 等终态，但禁止无间隔地高频轮询。',
  '- 工具超时或状态暂时未知时，不得擅自再次调用 execute_workflow，以免重复执行业务；应优先继续使用原 runId 查询状态。',
  '',
  '【工具边界与失败处理】',
  '- 创建、搜索、执行和查询 STO 工作流只能使用上述 STO 工作流工具。禁止通过 Bash、exec、sai-cli、直接 HTTP 请求或手工读写文件操作工作流。',
  '- 工作流工具参数错误时，根据错误信息修正；鉴权、网络或服务错误无法安全修正时，直接报告错误。禁止改用 shell、其他 CLI 或脚本绕过工作流工具。',
  '- 上述限制仅针对工作流本身，不限制后续通知等非工作流动作。普通的非工作流 sai-cli 命令允许执行。',
  '- `dws chat message send` 是发送结果通知，不是操作工作流；允许直接调用，即使其 --title 或 --text 中含有 workflow、工作流等字样，也不得因此放弃发送或改用其他方式。',
].join('\n');

const WORKFLOW_TOOL_NAMES = new Set(stoWorkflowTools.map((tool) => tool.name));
const SCHEMA_FETCHED_STATE_KEY = 'schema-fetched-in-turn';

export const stoWorkflowToolDefinition: SclawAgentExtensionDefinition = {
  id: 'sto-workflow-tool',
  version: '1.0.0',
  engines: ['claude', 'pi'],
  requiredCapabilities: [STO_WORKFLOW_CAPABILITY],
  activations: [{
    id: STO_WORKFLOW_MANAGEMENT_ACTIVATION,
    scope: 'session',
    match: matchesStoWorkflowIntent,
  }],
  tools: stoWorkflowTools,
  policies: [{
    id: 'workflow-management-guard',
    engines: ['claude', 'pi'],
    beforeTool(event, context) {
      if (event.toolName === 'get_workflow_schema') {
        context.state.turn.set(SCHEMA_FETCHED_STATE_KEY, true);
        return { action: 'allow' };
      }
      if (
        event.toolName === 'create_workflow'
        && context.state.turn.get<boolean>(SCHEMA_FETCHED_STATE_KEY)
      ) {
        return {
          action: 'deny',
          reason: 'get_workflow_schema already returned the startup schema. The client must collect and confirm parameters before create_workflow can be used.',
        };
      }
      if (event.toolKind === 'shell') {
        const command = typeof event.input.command === 'string' ? event.input.command : '';
        if (isWorkflowShellCommand(command)) {
          return {
            action: 'deny',
            reason: 'Do not operate STO workflows through shell commands. Use the STO workflow tools instead.',
          };
        }
      }
      return { action: 'allow' };
    },
    afterTool(event, context) {
      if (!WORKFLOW_TOOL_NAMES.has(event.toolName as typeof stoWorkflowTools[number]['name'])) return;
      context.logger.info('[agent-extension] workflow.tool.completed', {
        extensionId: 'sto-workflow-tool',
        toolName: event.toolName,
        status: event.isError ? 'error' : 'success',
      });
    },
  }],
  prompts: [{
    id: 'workflow-management-guidance',
    engines: ['claude', 'pi'],
    modes: ['interactive', 'scheduled'],
    activation: STO_WORKFLOW_MANAGEMENT_ACTIVATION,
    text: STO_WORKFLOW_SYSTEM_PROMPT,
  }],
};
