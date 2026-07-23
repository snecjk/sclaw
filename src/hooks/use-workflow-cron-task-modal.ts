import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useCronStore } from '@/stores/cron';
import { useAgentsStore } from '@/stores/agents';
import { useMyTaskStore } from '@/pages/MyTask/store';
import { prepareDingTalkAgentTurnMessage } from '@/lib/scheduled-task-recipients';
import type { TaskCreateInputWithRun } from '@/pages/MyTask/components/TaskCreateModal';

function resolvePreferredAgent(
  agents: Array<{ id: string; workspace: string }>,
  defaultAgentId: string,
) {
  if (agents.length === 0) return null;
  return agents.find((agent) => agent.id === defaultAgentId) ?? agents[0] ?? null;
}

export function useWorkflowCronTaskModal() {
  const createJob = useCronStore((s) => s.createJob);
  const agents = useAgentsStore((s) => s.agents);
  const defaultAgentId = useAgentsStore((s) => s.defaultAgentId);
  const [open, setOpen] = useState(false);
  const [initialValues, setInitialValues] = useState<{ workflowCode?: string }>();

  const openForWorkflow = useCallback(async (workflowId: string) => {
    // 确保 modal 内 select 有数据，使组件侧能解析 label 生成 instructions 模板
    if (useMyTaskStore.getState().workflowOptions.length === 0) {
      try {
        await useMyTaskStore.getState().fetchWorkflows();
      } catch {
        // 忽略，modal 内 select 兜底空列表
      }
    }
    setInitialValues({ workflowCode: workflowId });
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setInitialValues(undefined);
  }, []);

  const handleSave = useCallback(
    async (input: TaskCreateInputWithRun) => {
      const selectedAgent = resolvePreferredAgent(agents, defaultAgentId);
      try {
        if (input.engineType === 'claude') {
          if (!selectedAgent?.id) {
            throw new Error('所选 Claude 代理缺少工作区，无法创建本地定时任务');
          }
          const promptTemplate = prepareDingTalkAgentTurnMessage(
            input.message,
            input.dingTalkMentions,
            { scenario: 'scheduled-task' },
          );
          await createJob({
            engineType: 'claude',
            name: input.name,
            cronExpr: input.schedule,
            prompt: promptTemplate,
            agentId: selectedAgent.id,
            workspacePath: input.claudeWorkspacePath || selectedAgent.workspace,
            permissionProfile: input.claudePermissionProfile || 'dangerous-bypass',
            workflowCode: input.workflowCode,
          });
        } else {
          await createJob({
            engineType: 'openclaw',
            name: input.name,
            cronExpr: input.schedule,
            prompt: input.message,
            enabled: input.enabled,
            agentId: selectedAgent?.id || 'main',
            dingtalkRecipients: input.dingTalkMentions,
            workflowCode: input.workflowCode,
          });
        }
        toast.success('任务已创建');
        close();
      } catch (err) {
        const errStr = String(err);
        let userMessage = '操作失败，请稍后重试';
        if (errStr.includes('409') || errStr.includes('already exists') || errStr.includes('duplicate')) {
          userMessage = '任务名称已存在，请使用其他名称';
        } else if (errStr.includes('422') || errStr.includes('validation')) {
          userMessage = '输入内容不符合要求，请检查字段';
        }
        toast.error(userMessage);
        throw err;
      }
    },
    [agents, close, createJob, defaultAgentId],
  );

  return {
    open,
    initialValues,
    openForWorkflow,
    close,
    handleSave,
  };
}
