import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  isRecord,
  readConfigNumber,
  readConfigString,
} from '@/pages/WorkflowDesigner/inspector-config-utils';
import type { WorkflowDefinition, WorkflowNode } from '@/pages/WorkflowDesigner/types';

type BrowserSessionMode = 'embed' | 'upstream' | 'url' | 'sessionId';

const VALIDATOR_TYPES = [
  { value: 'elementText', label: '页面包含文本' },
  { value: 'url', label: 'URL 匹配' },
  { value: 'title', label: '标题匹配' },
  { value: 'elementExists', label: '元素存在' },
  { value: 'networkIdle', label: '网络空闲' },
] as const;

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

function readBrowserSessionMode(config: Record<string, unknown>): BrowserSessionMode {
  if (readConfigString(config, 'sessionId')) return 'sessionId';
  if (readConfigString(config, 'sessionFrom')) return 'upstream';
  if (readConfigString(config, 'url')) return 'url';
  return 'embed';
}

function patchBrowserSessionMode(
  config: Record<string, unknown>,
  mode: BrowserSessionMode,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...config,
    embedRuntimeId: '',
    sessionFrom: '',
    url: '',
    sessionId: '',
  };
  if (mode === 'embed') return next;
  if (mode === 'upstream') return { ...next, sessionFrom: 'browser' };
  if (mode === 'url') return { ...next, url: 'https://' };
  return { ...next, sessionId: '' };
}

function readFirstValidator(config: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(config.validators) && isRecord(config.validators[0])) {
    return config.validators[0] as Record<string, unknown>;
  }
  if (isRecord(config.validator)) return config.validator;
  return { type: 'elementText', expectedText: '提交成功' };
}

function patchFirstValidator(
  config: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const current = readFirstValidator(config);
  const nextValidator = { ...current, ...patch };
  return {
    ...config,
    validators: [nextValidator],
    validator: nextValidator,
  };
}

function BrowserSessionFields({
  config,
  patch,
}: {
  config: Record<string, unknown>;
  patch: (configPatch: Record<string, unknown>) => void;
}) {
  const mode = readBrowserSessionMode(config);
  return (
    <>
      <Field label="浏览器会话来源" hint="优先使用应用广场 embed 浏览器；也可继承上游 browser.sessionId。">
        <Select
          value={mode}
          onChange={(event) => patch(patchBrowserSessionMode(config, event.target.value as BrowserSessionMode))}
        >
          <option value="embed">应用广场 Embed（embedRuntimeId）</option>
          <option value="upstream">上游节点（sessionFrom）</option>
          <option value="url">独立 URL（托管窗口）</option>
          <option value="sessionId">手动 Session ID</option>
        </Select>
      </Field>
      {mode === 'embed' ? (
        <Field label="Embed Runtime ID">
          <Input
            value={readConfigString(config, 'embedRuntimeId')}
            onChange={(event) => patch({ embedRuntimeId: event.target.value })}
            placeholder="应用广场运行时 ID"
          />
        </Field>
      ) : null}
      {mode === 'upstream' ? (
        <Field label="上游字段路径">
          <Input
            value={readConfigString(config, 'sessionFrom', 'browser')}
            onChange={(event) => patch({ sessionFrom: event.target.value })}
            placeholder="browser 或 upstream.browser"
          />
        </Field>
      ) : null}
      {mode === 'url' ? (
        <Field label="目标 URL">
          <Input
            value={readConfigString(config, 'url')}
            onChange={(event) => patch({ url: event.target.value })}
            placeholder="https://example.com"
          />
        </Field>
      ) : null}
      {mode === 'sessionId' ? (
        <Field label="Session ID">
          <Input
            value={readConfigString(config, 'sessionId')}
            onChange={(event) => patch({ sessionId: event.target.value })}
            placeholder="embed-xxx 或 managed-xxx"
          />
        </Field>
      ) : null}
    </>
  );
}

export function DesignerBrowserNodeConfig({
  node,
  config,
  patch,
}: {
  node: WorkflowNode;
  workflow: WorkflowDefinition;
  config: Record<string, unknown>;
  patch: (configPatch: Record<string, unknown>) => void;
}) {
  if (node.type === 'browser_task') {
    return (
      <>
        <Field label="浏览器任务目标">
          <Textarea
            value={readConfigString(config, 'goal')}
            onChange={(event) => patch({ goal: event.target.value })}
            rows={2}
          />
        </Field>
        <Field label="补充说明">
          <Textarea
            value={readConfigString(config, 'instruction')}
            onChange={(event) => patch({ instruction: event.target.value })}
            rows={2}
          />
        </Field>
        <BrowserSessionFields config={config} patch={patch} />
        <Field label="最大步骤数">
          <Input
            type="number"
            value={String(readConfigNumber(config, 'maxSteps', 20))}
            onChange={(event) => patch({ maxSteps: Number(event.target.value) || 20 })}
          />
        </Field>
        <Field label="恢复策略" hint="工作流中断或重跑节点时，是否复用已有 ba_run checkpoint。">
          <Select
            value={config.resume === false ? 'new' : 'resume'}
            onChange={(event) => patch({ resume: event.target.value !== 'new' })}
          >
            <option value="resume">从 checkpoint 继续</option>
            <option value="new">重新开始</option>
          </Select>
        </Field>
      </>
    );
  }

  if (node.type === 'browser_validate') {
    const validator = readFirstValidator(config);
    const validatorType = readConfigString(validator, 'type', 'elementText');
    return (
      <>
        <BrowserSessionFields config={config} patch={patch} />
        <Field label="校验类型">
          <Select
            value={validatorType}
            onChange={(event) => patch(patchFirstValidator(config, { type: event.target.value }))}
          >
            {VALIDATOR_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        {validatorType === 'elementText' ? (
          <Field label="期望文本">
            <Input
              value={readConfigString(validator, 'expectedText')}
              onChange={(event) => patch(patchFirstValidator(config, { expectedText: event.target.value }))}
              placeholder="提交成功"
            />
          </Field>
        ) : null}
        {validatorType === 'url' || validatorType === 'title' ? (
          <Field label="匹配规则（正则或包含文本）">
            <Input
              value={readConfigString(validator, 'pattern')}
              onChange={(event) => patch(patchFirstValidator(config, { pattern: event.target.value }))}
              placeholder={validatorType === 'url' ? '/dashboard' : '首页'}
            />
          </Field>
        ) : null}
        {validatorType === 'elementExists' ? (
          <Field label="元素 ref 或 stableKey">
            <Input
              value={readConfigString(validator, 'ref') || readConfigString(validator, 'stableKey')}
              onChange={(event) => patch(patchFirstValidator(config, { ref: event.target.value }))}
              placeholder="@e3"
            />
          </Field>
        ) : null}
        <Field label="校验失败时">
          <Select
            value={readConfigString(config, 'onFail', 'fail')}
            onChange={(event) => patch({ onFail: event.target.value })}
          >
            <option value="fail">终止流程</option>
            <option value="human_gate">暂停等待人工</option>
          </Select>
        </Field>
      </>
    );
  }

  if (node.type === 'browser_human_gate') {
    return (
      <>
        <Field label="暂停原因">
          <Textarea
            value={readConfigString(config, 'reason', '请完成验证码或人工确认后继续')}
            onChange={(event) => patch({ reason: event.target.value })}
            rows={2}
          />
        </Field>
        <BrowserSessionFields config={config} patch={patch} />
      </>
    );
  }

  return null;
}
