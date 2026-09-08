import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useCronStore } from '@/stores/cron';
import { useAgentsStore } from '@/stores/agents';
import { useMyTaskStore } from '@/pages/MyTask/store';
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
  const [initialValues, setInitialValues] = useState<{ workflowCode?: string; workflowName?: string }>();

  const openForWorkflow = useCallback(async (workflowId: string) => {
    // 预拉工作流列表，便于 Modal seed workflow token 时解析展示名
    if (useMyTaskStore.getState().workflowOptions.length === 0) {
      try {
        await useMyTaskStore.getState().fetchWorkflows();
      } catch {
        // 忽略，Modal 内 composer 仍可用 id
      }
    }
    const label = useMyTaskStore.getState().workflowOptions.find((o) => o.value === workflowId)?.label;
    setInitialValues({ workflowCode: workflowId, workflowName: label });
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
        // 与 MyTask 对齐：三列 null；技能/工作流/收件人只在 extra
        const base = {
          name: input.name,
          cronExpr: input.schedule,
          prompt: input.message,
          dingtalkRecipients: null,
          skillCode: null,
          workflowCode: null,
          extra: input.extra ?? null,
          myArtifactFolderPath: input.myArtifactFolderPath ?? null,
          sharedArtifactFolderPath: input.sharedArtifactFolderPath ?? null,
        };
        if (input.engineType === 'claude' || input.engineType === 'pi') {
          if (!selectedAgent?.id) {
            const engineLabel = input.engineType === 'pi' ? 'SAgent' : 'Claude';
            throw new Error(`所选 ${engineLabel} 代理缺少工作区，无法创建本地定时任务`);
          }
          await createJob({
            ...base,
            engineType: input.engineType,
            agentId: selectedAgent.id,
            workspacePath: input.claudeWorkspacePath || selectedAgent.workspace,
            permissionProfile: input.engineType === 'pi'
              ? 'workspace-write'
              : input.claudePermissionProfile || 'dangerous-bypass',
          });
        } else {
          await createJob({
            ...base,
            engineType: 'openclaw',
            enabled: input.enabled,
            agentId: selectedAgent?.id || 'main',
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
