import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AGENT_OUTPUT_TEMPLATES } from '@/pages/WorkflowDesigner/constants';
import {
  buildDownstreamNodeOptions,
  buildSimpleCondition,
  buildSourceNodeOptions,
  isRecord,
  normalizeAgentTaskConfig,
  parseFieldOptionsText,
  parseSimpleCondition,
  patchAgentTaskConfig,
  patchNodeConfig,
  patchPrimaryBinding,
  patchSmartAgentConfig,
  readAgentTask,
  readBusinessConfig,
  readAgentConfig,
  readConfigNumber,
  readConfigString,
  readCsv,
  readFieldOptionsText,
  readPrimaryBinding,
  readStringArray,
  readUserInputFields,
  resolveSmartAgentKind,
  toFieldId,
  toggleValue,
  updateArrayItem,
  updateUserInputField,
  type UserInputField,
} from '@/pages/WorkflowDesigner/inspector-config-utils';
import type { WorkflowDefinition, WorkflowNode } from '@/pages/WorkflowDesigner/types';
import { DesignerBrowserNodeConfig } from '@/pages/WorkflowDesigner/components/designer-browser-node-config';

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

interface DesignerNodeTypeConfigProps {
  node: WorkflowNode;
  workflow: WorkflowDefinition;
  onChange: (node: WorkflowNode) => void;
}

export function DesignerNodeTypeConfig({ node, workflow, onChange }: DesignerNodeTypeConfigProps) {
  const config = node.config;
  const patch = (configPatch: Record<string, unknown>) => onChange(patchNodeConfig(node, configPatch));
  const smartKind = resolveSmartAgentKind(node.type);

  if (node.type === 'trigger') {
    const acceptedTypes = readCsv(config.acceptedTypes);
    const triggerType = readConfigString(config, 'triggerType', 'manual');
    return (
      <>
        <Field label="触发方式">
          <Select value={triggerType} onChange={(e) => patch({ triggerType: e.target.value })}>
            <option value="manual">手动开始</option>
            <option value="file_uploaded">上传文件开始</option>
            <option value="schedule">定时开始</option>
            <option value="webhook">收到请求开始</option>
          </Select>
        </Field>
        {triggerType === 'file_uploaded' ? (
          <Field label="允许上传的文件类型">
            <div className="space-y-1 rounded-lg border border-border p-2">
              {['txt', 'md', 'pdf', 'docx', 'xlsx'].map((ext) => (
                <label key={ext} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="sto-native-checkbox"
                    checked={acceptedTypes.includes(ext)}
                    onChange={() => patch({ acceptedTypes: toggleValue(acceptedTypes, ext).join(',') })}
                  />
                  <span>{ext.toUpperCase()}</span>
                </label>
              ))}
            </div>
          </Field>
        ) : null}
        <Field label="触发样例说明">
          <Textarea
            value={readConfigString(config, 'sampleNote')}
            onChange={(e) => patch({ sampleNote: e.target.value })}
            placeholder="例如：上传待审核合同、上传客户名单。"
            rows={2}
          />
        </Field>
      </>
    );
  }

  if (node.type === 'startup_config') {
    const steps = Array.isArray(config.steps) ? config.steps.filter(isRecord) : [];
    return (
      <>
        <Field label="启动说明" hint="这个系统节点会汇总其他节点声明的启动参数，在运行前让用户确认并复用预设。">
          <p className="text-sm text-muted-foreground">在下方维护确认步骤。</p>
        </Field>
        <Field label="确认步骤">
          <div className="space-y-2">
            {steps.map((step, index) => (
              <div key={`step-${index}`} className="space-y-2 rounded-lg border border-border p-2">
                <Input
                  value={String(step.id ?? '')}
                  placeholder="步骤 ID，例如 fetch"
                  onChange={(e) =>
                    patch({ steps: updateArrayItem(steps, index, { id: e.target.value }) })
                  }
                />
                <Input
                  value={String(step.title ?? '')}
                  placeholder="步骤标题"
                  onChange={(e) =>
                    patch({ steps: updateArrayItem(steps, index, { title: e.target.value }) })
                  }
                />
                <div className="flex gap-2">
                  <Select
                    value={String(step.mode ?? 'confirm')}
                    onChange={(e) =>
                      patch({ steps: updateArrayItem(steps, index, { mode: e.target.value }) })
                    }
                  >
                    <option value="confirm">逐项确认</option>
                    <option value="review">只读回顾</option>
                  </Select>
                  <button
                    type="button"
                    className="text-xs text-destructive hover:underline"
                    onClick={() => patch({ steps: steps.filter((_, i) => i !== index) })}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() =>
                patch({
                  steps: [
                    ...steps,
                    { id: `step_${steps.length + 1}`, title: `步骤 ${steps.length + 1}`, mode: 'confirm' },
                  ],
                })
              }
            >
              新增确认步骤
            </button>
          </div>
        </Field>
      </>
    );
  }

  if (node.type === 'user_input') {
    const fields = readUserInputFields(config);
    return (
      <>
        <Field label="这一步要补什么">
          <Input
            value={readConfigString(config, 'title')}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="例如：请补充客户资料"
          />
        </Field>
        <Field label="填写说明">
          <Textarea
            value={readConfigString(config, 'instruction')}
            onChange={(e) => patch({ instruction: e.target.value })}
            placeholder="例如：请填写客户背景，并上传相关附件。"
            rows={2}
          />
        </Field>
        <Field label="谁来填写">
          <Select
            value={readConfigString(config, 'assigneeRole', 'reviewer')}
            onChange={(e) => patch({ assigneeRole: e.target.value })}
          >
            <option value="reviewer">通用填写人</option>
            <option value="sales">销售</option>
            <option value="legal">法务</option>
            <option value="ops">运营</option>
            <option value="customer_service">客服</option>
          </Select>
        </Field>
        <Field label="需要填写的内容">
          <div className="space-y-2">
            {fields.map((field, index) => (
              <UserInputFieldEditor
                key={`${field.id}-${index}`}
                field={field}
                onChange={(next) => patch({ fields: updateUserInputField(fields, index, next) })}
                onRemove={() => patch({ fields: fields.filter((_, i) => i !== index) })}
              />
            ))}
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() =>
                patch({
                  fields: [
                    ...fields,
                    { id: `field_${fields.length + 1}`, label: '', type: 'text', required: false, placeholder: '' },
                  ],
                })
              }
            >
              新增填写项
            </button>
          </div>
        </Field>
        <Field label="处理时限（分钟）">
          <Input
            type="number"
            value={String(readConfigNumber(config, 'slaMinutes', 60))}
            onChange={(e) => patch({ slaMinutes: Number(e.target.value) || 60 })}
          />
        </Field>
      </>
    );
  }

  if (node.type === 'transform') {
    const transformMode = readConfigString(config, 'transformMode', 'normalize');
    const sourceOptions = buildSourceNodeOptions(workflow, node.id);
    const selectedFields = readStringArray(config.selectedFields);
    return (
      <>
        <Field label="整理方式">
          <Select value={transformMode} onChange={(e) => patch({ transformMode: e.target.value })}>
            <option value="normalize">直接整理成标准格式</option>
            <option value="filter">按条件筛选</option>
            <option value="map">只保留指定字段</option>
            <option value="aggregate">汇总统计</option>
          </Select>
        </Field>
        <Field label="整理哪份内容">
          <Select value={readConfigString(config, 'sourcePath')} onChange={(e) => patch({ sourcePath: e.target.value })}>
            <option value="">默认使用上一步结果</option>
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        {transformMode === 'filter' ? (
          <>
            <Field label="按哪个字段筛选">
              <Input
                value={readConfigString(config, 'filterField')}
                onChange={(e) => patch({ filterField: e.target.value })}
                placeholder="字段名"
              />
            </Field>
            <Field label="筛选方式">
              <Select
                value={readConfigString(config, 'filterOperator', '==')}
                onChange={(e) => patch({ filterOperator: e.target.value })}
              >
                <option value="==">等于</option>
                <option value="!=">不等于</option>
                <option value="contains">包含</option>
                <option value="in">属于以下值</option>
              </Select>
            </Field>
            <Field label="筛选值">
              <Input
                value={readConfigString(config, 'filterValue')}
                onChange={(e) => patch({ filterValue: e.target.value })}
              />
            </Field>
          </>
        ) : null}
        {transformMode === 'map' ? (
          <Field label="保留哪些关键项（每行一个）">
            <Textarea
              value={selectedFields.join('\n')}
              onChange={(e) =>
                patch({ selectedFields: e.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })
              }
              rows={3}
            />
          </Field>
        ) : null}
        {transformMode === 'aggregate' ? (
          <Field label="显示几条示例">
            <Input
              type="number"
              value={String(readConfigNumber(config, 'summarySampleSize', 3))}
              onChange={(e) => patch({ summarySampleSize: Number(e.target.value) || 3 })}
            />
          </Field>
        ) : null}
        {transformMode === 'normalize' ? (
          <>
            <Field label="整理成什么样">
              <Select
                value={readConfigString(config, 'normalizeTarget', 'standard_result')}
                onChange={(e) => patch({ normalizeTarget: e.target.value })}
              >
                <option value="standard_result">标准结果</option>
                <option value="readable_summary">便于阅读的摘要</option>
                <option value="save_ready">便于保存的结果</option>
              </Select>
            </Field>
            <Field label="补充说明">
              <Textarea
                value={readConfigString(config, 'mappingExpression')}
                onChange={(e) => patch({ mappingExpression: e.target.value })}
                rows={2}
              />
            </Field>
          </>
        ) : null}
      </>
    );
  }

  if (node.type === 'condition') {
    const expression = readConfigString(config, 'expression') || readConfigString(config, 'condition');
    const parts = parseSimpleCondition(expression);
    const selectedField = parts.field;
    return (
      <>
        <Field label="判断字段">
          <Input
            value={selectedField}
            onChange={(e) => {
              const next = buildSimpleCondition({ ...parts, field: e.target.value });
              patch({ condition: next, expression: next });
            }}
            placeholder="例如：nodes.risk_review.output.riskLevel"
          />
        </Field>
        <Field label="判断方式">
          <Select
            value={parts.operator}
            onChange={(e) => {
              const next = buildSimpleCondition({
                ...parts,
                operator: e.target.value as typeof parts.operator,
              });
              patch({ condition: next, expression: next });
            }}
          >
            <option value="==">等于</option>
            <option value="!=">不等于</option>
            <option value="in">属于以下值</option>
          </Select>
        </Field>
        <Field label="判断值">
          <Input
            value={parts.value}
            onChange={(e) => {
              const next = buildSimpleCondition({ ...parts, value: e.target.value });
              patch({ condition: next, expression: next });
            }}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="命中后标记">
            <Input
              value={readConfigString(config, 'truePort', 'true')}
              onChange={(e) => patch({ truePort: e.target.value, trueBranch: e.target.value })}
            />
          </Field>
          <Field label="未命中标记">
            <Input
              value={readConfigString(config, 'falsePort', 'false')}
              onChange={(e) => patch({ falsePort: e.target.value, falseBranch: e.target.value })}
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          连线条件里填写与这里一致的标记值，系统会按结果自动往下走。
        </p>
      </>
    );
  }

  if (node.type === 'human_approval') {
    return (
      <>
        <Field label="什么情况下需要人工审核">
          <Textarea
            value={readConfigString(config, 'condition')}
            onChange={(e) => patch({ condition: e.target.value })}
            rows={2}
          />
        </Field>
        <Field label="谁来审核">
          <Select
            value={readConfigString(config, 'assigneeRole', 'reviewer')}
            onChange={(e) => patch({ assigneeRole: e.target.value })}
          >
            <option value="reviewer">通用审核人</option>
            <option value="legal">法务</option>
            <option value="sales_manager">销售负责人</option>
            <option value="ops">运营</option>
          </Select>
        </Field>
        <Field label="处理时限（分钟）">
          <Input
            type="number"
            value={String(readConfigNumber(config, 'slaMinutes', 30))}
            onChange={(e) => patch({ slaMinutes: Number(e.target.value) || 30 })}
          />
        </Field>
      </>
    );
  }

  if (node.type === 'action') {
    const actionType = readConfigString(config, 'actionType', 'push_result');
    const sourceOptions = buildSourceNodeOptions(workflow, node.id);
    const binding = readPrimaryBinding(config);
    return (
      <>
        <Field label="要执行什么">
          <Select value={actionType} onChange={(e) => patch({ actionType: e.target.value })}>
            <option value="push_result">同步结果到业务系统</option>
            <option value="create_ticket">创建待办任务</option>
            <option value="send_message">发送通知消息</option>
          </Select>
        </Field>
        <Field label="发到哪里">
          <Select value={readConfigString(config, 'target', 'business_system')} onChange={(e) => patch({ target: e.target.value })}>
            {actionType === 'send_message' ? (
              <>
                <option value="email">邮件通知</option>
                <option value="business_system">业务系统消息</option>
              </>
            ) : actionType === 'create_ticket' ? (
              <>
                <option value="ticket_system">工单系统</option>
                <option value="ops_queue">运营处理队列</option>
                <option value="customer_service_queue">客服处理队列</option>
              </>
            ) : (
              <>
                <option value="business_system">业务系统</option>
                <option value="crm">CRM</option>
                <option value="knowledge_base">知识库</option>
              </>
            )}
          </Select>
        </Field>
        <Field label="发送哪一步结果">
          <Select
            value={binding.nodeId}
            onChange={(e) => patch(patchPrimaryBinding(config, { nodeId: e.target.value, port: 'default' }))}
          >
            <option value="">默认使用上一步结果</option>
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="补充说明">
          <Textarea value={readConfigString(config, 'note')} onChange={(e) => patch({ note: e.target.value })} rows={2} />
        </Field>
      </>
    );
  }

  if (node.type === 'output') {
    const sourceOptions = buildSourceNodeOptions(workflow, node.id);
    const binding = readPrimaryBinding(config);
    const fileNameMode = readConfigString(config, 'fileNameMode', 'default');
    return (
      <>
        <Field label="保存哪一步结果">
          <Select
            value={binding.nodeId}
            onChange={(e) => patch(patchPrimaryBinding(config, { nodeId: e.target.value, port: 'default' }))}
          >
            <option value="">默认使用流程结果</option>
            {sourceOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="保存到哪里">
          <Select value={readConfigString(config, 'target', 'report_center')} onChange={(e) => patch({ target: e.target.value })}>
            <option value="report_center">报告中心</option>
            <option value="archive">归档记录</option>
            <option value="knowledge_base">知识库</option>
            <option value="local_file">本地文件</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="保存形式">
            <Select value={readConfigString(config, 'format', 'structured_json')} onChange={(e) => patch({ format: e.target.value })}>
              <option value="structured_json">结构化结果</option>
              <option value="readable_report">可阅读报告</option>
            </Select>
          </Field>
          <Field label="文件名称">
            <Select value={fileNameMode} onChange={(e) => patch({ fileNameMode: e.target.value })}>
              <option value="default">自动命名</option>
              <option value="custom">自定义名称</option>
            </Select>
          </Field>
        </div>
        {fileNameMode === 'custom' ? (
          <Field label="自定义文件名称">
            <Input
              value={readConfigString(config, 'fileNameTemplate')}
              onChange={(e) => patch({ fileNameTemplate: e.target.value })}
            />
          </Field>
        ) : null}
        {readConfigString(config, 'format', 'structured_json') === 'readable_report' ? (
          <Field label="保存前整理说明">
            <Textarea
              value={readConfigString(config, 'renderInstruction')}
              onChange={(e) => patch({ renderInstruction: e.target.value })}
              rows={2}
            />
          </Field>
        ) : null}
      </>
    );
  }

  if (node.type === 'agent_task') {
    const agent = normalizeAgentTaskConfig(config);
    const sourceOptions = buildSourceNodeOptions(workflow, node.id);
    return (
      <>
        <Field label="这一步要做什么">
          <Textarea
            value={agent.task.goal}
            onChange={(e) => patch(patchAgentTaskConfig(config, { task: { goal: e.target.value } }))}
            rows={2}
          />
        </Field>
        <Field label="补充说明">
          <Textarea
            value={agent.task.instruction}
            onChange={(e) => patch(patchAgentTaskConfig(config, { task: { instruction: e.target.value } }))}
            rows={2}
          />
        </Field>
        <Field label="结果类型">
          <Select
            value={agent.task.outputTemplateId}
            onChange={(e) =>
              patch(patchAgentTaskConfig(config, { task: { outputTemplateId: e.target.value } }))
            }
          >
            {AGENT_OUTPUT_TEMPLATES.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="是否需要人工把关">
          <Select
            value={agent.guardrails.approvalMode}
            onChange={(e) =>
              patch(patchAgentTaskConfig(config, { guardrails: { approvalMode: e.target.value } }))
            }
          >
            <option value="approval_required">需要</option>
            <option value="manual_only">仅人工确认后可继续</option>
            <option value="none">不需要</option>
          </Select>
        </Field>
        <Field label="运行方式">
          <Select
            value={agent.runtime.provider}
            onChange={(e) => patch(patchAgentTaskConfig(config, { runtime: { provider: e.target.value } }))}
          >
            <option value="cloud_agent">云端 Agent</option>
            <option value="claude_agent_sdk">Claude Agent SDK</option>
            <option value="openclaw_local">本地 OpenClaw</option>
            <option value="custom">自定义</option>
          </Select>
        </Field>
        <Field label="智能体 ID">
          <Input
            value={agent.runtime.agentId}
            onChange={(e) => patch(patchAgentTaskConfig(config, { runtime: { agentId: e.target.value } }))}
            placeholder="例如：contract-reviewer"
          />
        </Field>
        <Field label="引用数据来源">
          <Select
            value={agent.inputs.mode}
            onChange={(e) => patch(patchAgentTaskConfig(config, { inputs: { mode: e.target.value } }))}
          >
            <option value="auto_previous">默认使用上一步输出</option>
            <option value="selected_sources">手动选择资料来源</option>
          </Select>
        </Field>
        {agent.inputs.mode === 'selected_sources' ? (
          <Field label="资料来源节点">
            <div className="space-y-1 rounded-lg border border-border p-2">
              {sourceOptions.map((option) => {
                const checked = agent.inputs.sourceNodeIds.includes(option.value);
                return (
                  <label key={option.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="sto-native-checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = checked
                          ? agent.inputs.sourceNodeIds.filter((id) => id !== option.value)
                          : [...agent.inputs.sourceNodeIds, option.value];
                        patch(patchAgentTaskConfig(config, { inputs: { sourceNodeIds: next } }));
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          </Field>
        ) : null}
      </>
    );
  }

  if (smartKind) {
    const businessConfig = readBusinessConfig(config);
    const agentConfig = readAgentConfig(config);
    const agentTask = readAgentTask(config);
    const sourceOptions = buildSourceNodeOptions(workflow, node.id);
    const inputsConfig = isRecord(agentConfig.inputs) ? agentConfig.inputs : {};
    const inputMode = readConfigString(inputsConfig, 'mode', 'auto_previous');
    const selectedSourceIds = Array.isArray(inputsConfig.sourceNodeIds)
      ? inputsConfig.sourceNodeIds.filter((id): id is string => typeof id === 'string')
      : [];
    const goalLabel =
      smartKind === 'agent_data_fetch'
        ? '抽取目标'
        : smartKind === 'agent_output'
          ? '输出目标'
          : smartKind === 'agent_condition'
            ? '判定目标'
            : '处理目标';
    const ruleLabel = smartKind === 'agent_condition' ? '规则描述' : '处理规则';
    const branches = Array.isArray(config.branches) ? config.branches.filter(isRecord) : [];
    const downstreamOptions = buildDownstreamNodeOptions(workflow, node.id);

    return (
      <>
        {smartKind !== 'agent_data_fetch' ? (
          <Field label="引用数据来源">
            <Select
              value={inputMode}
              onChange={(e) =>
                patch(
                  patchSmartAgentConfig(config, {
                    agentConfig: { inputs: { ...inputsConfig, mode: e.target.value } },
                  }),
                )
              }
            >
              <option value="auto_previous">默认使用上一步输出</option>
              <option value="selected_sources">手动选择资料来源</option>
            </Select>
            {inputMode === 'selected_sources' ? (
              <div className="mt-2 space-y-1 rounded-lg border border-border p-2">
                {sourceOptions.map((option) => {
                  const checked = selectedSourceIds.includes(option.value);
                  return (
                    <label key={option.value} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="sto-native-checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? selectedSourceIds.filter((id) => id !== option.value)
                            : [...selectedSourceIds, option.value];
                          patch(
                            patchSmartAgentConfig(config, {
                              agentConfig: { inputs: { ...inputsConfig, sourceNodeIds: next } },
                            }),
                          );
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </Field>
        ) : (
          <Field label="资料提供方式" hint="当前先支持试运行时上传或节点内预置。">
            <Select
              value={readConfigString(businessConfig, 'inputProvisionMode', 'node_embedded')}
              onChange={(e) =>
                patch(patchSmartAgentConfig(config, { businessConfig: { inputProvisionMode: e.target.value } }))
              }
            >
              <option value="runtime_upload">试运行时上传</option>
              <option value="node_embedded">节点内预置</option>
              <option value="mixed">两者都支持</option>
            </Select>
          </Field>
        )}
        <Field label={goalLabel}>
          <Input
            value={readConfigString(businessConfig, 'goal')}
            onChange={(e) =>
              patch(
                patchSmartAgentConfig(config, {
                  businessConfig: { goal: e.target.value },
                  agentConfig: { task: { ...agentTask, goal: e.target.value } },
                }),
              )
            }
          />
        </Field>
        {smartKind !== 'agent_condition' ? (
          <>
            <Field label={ruleLabel}>
              <Textarea
                value={readConfigString(businessConfig, 'rule')}
                onChange={(e) => patch(patchSmartAgentConfig(config, { businessConfig: { rule: e.target.value } }))}
                rows={2}
              />
            </Field>
            <Field label="Agent 执行提示词">
              <Textarea
                value={readConfigString(agentTask, 'instruction')}
                onChange={(e) =>
                  patch(patchSmartAgentConfig(config, { agentConfig: { task: { ...agentTask, instruction: e.target.value } } }))
                }
                rows={3}
              />
            </Field>
          </>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label={smartKind === 'agent_condition' ? '判定对象' : '分析对象'}>
            <Input
              value={readConfigString(businessConfig, 'subject')}
              onChange={(e) => patch(patchSmartAgentConfig(config, { businessConfig: { subject: e.target.value } }))}
            />
          </Field>
          <Field label={smartKind === 'agent_condition' ? '补充说明' : '补充上下文'}>
            <Input
              value={readConfigString(businessConfig, 'contextNote')}
              onChange={(e) => patch(patchSmartAgentConfig(config, { businessConfig: { contextNote: e.target.value } }))}
            />
          </Field>
        </div>
        {smartKind === 'agent_condition' ? (
          <Field label="分支配置" hint="分支节点来自当前节点已连接的下游节点。">
            <div className="space-y-2">
              {branches.map((branch, index) => (
                <div key={`branch-${index}`} className="space-y-2 rounded-lg border border-border p-2">
                  <Select
                    value={String(branch.targetNodeId ?? '')}
                    onChange={(e) =>
                      patch({
                        branches: updateArrayItem(branches, index, { targetNodeId: e.target.value }),
                      })
                    }
                  >
                    <option value="">请选择下游节点</option>
                    {downstreamOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <Textarea
                    value={String(branch.routeRuleHint ?? '')}
                    onChange={(e) =>
                      patch({ branches: updateArrayItem(branches, index, { routeRuleHint: e.target.value }) })
                    }
                    placeholder="命中条件描述"
                    rows={2}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`fallback-${node.id}`}
                      checked={Boolean(branch.isFallback)}
                      onChange={() =>
                        patch({
                          branches: branches.map((item, branchIndex) => ({
                            ...item,
                            isFallback: branchIndex === index,
                          })),
                        })
                      }
                    />
                    兜底分支
                  </label>
                </div>
              ))}
            </div>
          </Field>
        ) : null}
      </>
    );
  }

  if (node.type === 'browser_task' || node.type === 'browser_validate' || node.type === 'browser_human_gate') {
    return (
      <DesignerBrowserNodeConfig
        node={node}
        workflow={workflow}
        config={config}
        patch={patch}
      />
    );
  }

  return null;
}

function UserInputFieldEditor({
  field,
  onChange,
  onRemove,
}: {
  field: UserInputField;
  onChange: (field: UserInputField) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-2">
      <Input
        value={field.label}
        placeholder="字段名称"
        onChange={(e) => onChange({ ...field, label: e.target.value, id: toFieldId(e.target.value || field.id) })}
      />
      <Select value={field.type} onChange={(e) => onChange({ ...field, type: e.target.value })}>
        <option value="text">单行文本</option>
        <option value="textarea">多行说明</option>
        <option value="number">数字</option>
        <option value="select">下拉选择</option>
        <option value="radio">单选</option>
        <option value="checkbox">勾选</option>
        <option value="file">上传文件</option>
      </Select>
      <Input
        value={field.placeholder ?? ''}
        placeholder="占位提示"
        onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
      />
      <Select
        value={field.required ? 'yes' : 'no'}
        onChange={(e) => onChange({ ...field, required: e.target.value === 'yes' })}
      >
        <option value="yes">必填</option>
        <option value="no">选填</option>
      </Select>
      {field.type === 'select' || field.type === 'radio' ? (
        <Textarea
          value={readFieldOptionsText(field.options)}
          onChange={(e) => onChange({ ...field, options: parseFieldOptionsText(e.target.value) })}
          placeholder="每行一个选项"
          rows={2}
        />
      ) : null}
      <button type="button" className="text-xs text-destructive hover:underline" onClick={onRemove}>
        删除这个字段
      </button>
    </div>
  );
}
