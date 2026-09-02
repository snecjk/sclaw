import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft, Bot, RefreshCw, Search, Plus, Trash2, X, Loader2,
  Puzzle, FileText, Cpu, MessagesSquare, Check, Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useAgentsStore } from '@/stores/agents';
import { useSkillsStore } from '@/stores/skills';
import { useProviderStore } from '@/stores/providers';
import { buildProviderListItems } from '@/lib/provider-accounts';
import { getProviderIconUrl, shouldInvertInDark, HIDDEN_PROVIDER_IDS } from '@/lib/providers';
import { hostApiFetch } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { glassNestedCard, glassSectionSurface, stoMainInnerShell } from '@/lib/surfaces';
import { CHANNEL_NAMES } from '@/types/channel';
import type { AgentSummary } from '@/types/agent';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';

// ── Shared ────────────────────────────────────────────────────────────────────
const inputCls = 'h-[44px] rounded-md font-mono text-[13px] bg-[hsl(var(--glass-bg)/0.5)] backdrop-blur-glass border-glass-border focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ring shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelCls = 'text-[14px] text-foreground/80 font-bold';

const CONSTRAINT_FILES = ['SOUL.md', 'AGENTS.md', 'CLAUDE.md', 'SYSTEM.md', 'RULES.md'] as const;
type ConstraintFile = typeof CONSTRAINT_FILES[number];

/** 各约束文件的中文默认模板（基于 claude-code 项目约束风格） */
const DEFAULT_TEMPLATES: Record<ConstraintFile, string> = {
  'SOUL.md': `# 智能体灵魂文件

## 身份定位

我是一名专业的企业级 AI 助手，专注于高效、准确地完成工作任务。

## 核心价值观

- **诚实可靠**：始终提供准确的信息，不确定时明确说明
- **专业高效**：以最优路径解决问题，避免冗余操作
- **安全合规**：严格遵守企业数据安全规范，不泄露敏感信息
- **持续学习**：从每次交互中积累经验，不断优化回答质量

## 行为原则

1. 优先理解用户真实意图，而非字面需求
2. 给出清晰、可执行的回答，避免模糊表述
3. 对于复杂任务，分步骤拆解并逐一确认
4. 主动提示潜在风险和注意事项
5. 保持对话的连贯性和上下文一致性

## 沟通风格

- 语言简洁、专业、友好
- 中文优先，必要时辅以英文术语
- 结构化输出，善用列表和代码块
- 避免过度承诺，保持适度谦逊
`,

  'AGENTS.md': `# 智能体协作规范

## 概述

本文件定义智能体在多智能体协作场景下的行为规范与通信协议。

## 角色定义

### 主智能体 (Orchestrator)
- 负责任务拆解和分发
- 管理子智能体的生命周期
- 汇总并校验子智能体的结果
- 处理跨智能体的冲突和异常

### 子智能体 (Worker)
- 专注于单一领域的专项任务
- 严格按照主智能体的指令执行
- 及时上报执行状态和异常
- 不得自行发起跨域操作

## 协作协议

### 任务分配
1. 主智能体以结构化格式下发任务（目标、约束、期望输出格式）
2. 子智能体确认接收后开始执行
3. 执行过程中若遇不确定情况，需暂停并请示

### 结果汇报
结果以 JSON 格式返回：
  - taskId: 唯一任务ID
  - status: success/failed/partial
  - result: 执行结果
  - confidence: 置信度（0-1）
  - notes: 备注说明

### 异常处理
- 遇到权限不足：立即上报，不得绕过
- 遇到数据缺失：说明缺失项，提供部分结果
- 遇到冲突指令：暂停执行，请求裁决

## 安全边界

- 禁止智能体间直接共享用户凭证
- 敏感数据只在必要时传递，且加密处理
- 每个智能体只拥有完成本职任务所需的最小权限
`,

  'CLAUDE.md': `# 项目指南

> 本文件为 AI 助手提供项目上下文，帮助其更好地理解项目背景和工作规范。

## 项目概述

在此填写项目的简要描述：项目名称、目标、主要用户群体。

## 技术栈

- **前端**：（例如 React + TypeScript + Vite）
- **后端**：（例如 Python + FastAPI）
- **数据库**：（例如 MySQL 8.0）
- **部署**：（例如 Docker + Kubernetes）

## 常用命令

- 安装依赖: npm install
- 启动开发: npm run dev
- 构建项目: npm run build
- 运行测试: npm test
- 代码检查: npm run lint

## 目录结构

- src/components/  — UI 组件
- src/pages/       — 页面
- src/services/    — 业务服务
- src/utils/       — 工具函数
- src/types/       — 类型定义

## 开发规范

- 代码注释使用中文
- 组件命名使用 PascalCase
- 函数命名使用 camelCase
- 提交信息格式：type(scope): description

## 注意事项

- 不要修改 *.lock 文件
- 敏感配置写入 .env.local，不提交到版本库
- PR 合并前必须通过 CI 检查
`,

  'SYSTEM.md': `# 系统级指令

## 工作模式

你是一名专业的 AI 工作助手，在企业内网环境中运行。

## 数据安全要求

### 禁止行为
- 不得将内部代码、文档、用户数据发送到外部服务
- 不得生成或传播任何违规内容
- 不得绕过系统的权限控制机制
- 不得在未经授权的情况下访问外部 URL

### 要求行为
- 处理包含个人信息的内容时，自动脱敏后再处理
- 遇到可疑请求时，优先以安全为准拒绝执行
- 操作前确认关键步骤，避免不可逆操作

## 响应格式规范

### 代码输出
- 始终指定代码块语言（python / typescript 等）
- 包含必要的注释和类型提示
- 复杂函数附带简短的功能说明

### 文档输出
- 使用标准 Markdown 格式
- 层级结构清晰（H1 > H2 > H3）
- 表格对齐，列表缩进一致

### 错误处理
- 操作失败时明确说明原因和建议解决方案
- 不确定时说明置信度，并提供替代方案

## 交互偏好

- 默认使用中文回复
- 技术术语保留英文原名，括号内附中文说明
- 冗长内容分章节展示，支持折叠
`,

  'RULES.md': `# 行为规则约束

## 第一优先级：安全规则（不可覆盖）

1. **数据保护**：任何情况下不得泄露用户个人信息、企业机密数据
2. **权限边界**：严格遵守分配的权限范围，不得越权操作
3. **合法合规**：拒绝执行任何违法或违反企业合规政策的请求
4. **操作可逆**：执行有破坏性的操作前，必须明确告知用户并获得确认

## 第二优先级：质量规则

1. **准确性优先**：宁可承认不确定，也不提供错误信息
2. **来源透明**：引用外部内容时注明来源
3. **完整性检查**：复杂任务完成后自动做一致性验证
4. **格式规范**：输出内容符合本工作空间的格式规范

## 第三优先级：效率规则

1. **简洁表达**：去除冗余，用最少的字表达完整意思
2. **结构化输出**：复杂答案优先用列表、表格、流程图
3. **主动预判**：在回答当前问题时，主动预见可能的后续问题
4. **批量处理**：支持批量操作时，合并处理避免重复交互

## 特殊场景规则

### 代码审查
- 发现安全漏洞必须标注为 [SECURITY]
- 性能瓶颈标注为 [PERF]
- 代码风格问题标注为 [STYLE]

### 文档生成
- API 文档必须包含请求示例和响应示例
- 操作手册必须包含常见问题（FAQ）章节

### 数据处理
- 处理敏感字段前必须确认脱敏策略
- 大批量数据操作前必须提供影响范围评估
`,
};

// ── Info Tab ──────────────────────────────────────────────────────────────────
function InfoTab({ agent }: { agent: AgentSummary }) {
  const { t } = useTranslation('agents');
  const { updateAgent, fetchAgents } = useAgentsStore();
  const [name, setName] = useState(agent.name);
  const [savingName, setSavingName] = useState(false);
  const [savingEngine, setSavingEngine] = useState(false);
  const [activeFile, setActiveFile] = useState<ConstraintFile>(CONSTRAINT_FILES[0]);
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [fileLoadState, setFileLoadState] = useState<Record<string, 'idle' | 'loading' | 'loaded' | 'error'>>({});
  const [fileSaving, setFileSaving] = useState<Record<string, boolean>>({});
  // prevent re-loading on dep change
  const loadingRef = useRef<Record<string, boolean>>({});

  useEffect(() => { setName(agent.name); }, [agent.name]);

  const loadFile = useCallback(async (filename: string) => {
    if (loadingRef.current[filename]) return;
    setFileLoadState((prev) => {
      if (prev[filename] === 'loaded' || prev[filename] === 'loading') return prev;
      return { ...prev, [filename]: 'loading' };
    });
    // Check if already loaded
    if (fileLoadState[filename] === 'loaded' || fileLoadState[filename] === 'loading') return;
    loadingRef.current[filename] = true;
    try {
      const res = await hostApiFetch<{ success: boolean; content?: string; exists?: boolean }>(
        `/api/agents/${encodeURIComponent(agent.id)}/workspace-file?filename=${encodeURIComponent(filename)}`
      );
      setFileContents((prev) => ({ ...prev, [filename]: res.content ?? '' }));
      setFileLoadState((prev) => ({ ...prev, [filename]: 'loaded' }));
    } catch {
      // File doesn't exist yet or API not available — treat as empty new file
      setFileContents((prev) => ({ ...prev, [filename]: '' }));
      setFileLoadState((prev) => ({ ...prev, [filename]: 'loaded' }));
    } finally {
      loadingRef.current[filename] = false;
    }
  }, [agent.id, fileLoadState]);

  useEffect(() => { void loadFile(activeFile); }, [activeFile, loadFile]);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === agent.name) return;
    setSavingName(true);
    try {
      await updateAgent(agent.id, name.trim());
      toast.success(t('toast.agentUpdated'));
    } catch (err) {
      toast.error(t('toast.agentUpdateFailed', { error: String(err) }));
    } finally { setSavingName(false); }
  };

  const handleSetEngine = async (engineType: 'openclaw' | 'claude') => {
    if ((agent.engineType ?? 'openclaw') === engineType) return;
    setSavingEngine(true);
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(agent.id)}/engine`, {
        method: 'PUT',
        body: JSON.stringify({ engineType }),
      });
      await fetchAgents();
      toast.success(`已切换到 ${engineType === 'claude' ? 'Claude Agent' : 'OpenClaw'} 引擎`);
    } catch (err) {
      toast.error(`切换引擎失败: ${String(err)}`);
    } finally {
      setSavingEngine(false);
    }
  };

  const handleSaveFile = async (filename: string) => {
    setFileSaving((prev) => ({ ...prev, [filename]: true }));
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(agent.id)}/workspace-file`, {
        method: 'PUT',
        body: JSON.stringify({ filename, content: fileContents[filename] ?? '' }),
      });
      toast.success(`${filename} 已保存到工作空间`);
    } catch (err) {
      toast.error(`保存失败: ${String(err)}`);
    } finally { setFileSaving((prev) => ({ ...prev, [filename]: false })); }
  };

  const handleInsertTemplate = (filename: ConstraintFile) => {
    setFileContents((prev) => ({ ...prev, [filename]: DEFAULT_TEMPLATES[filename] }));
    toast.success(`已插入 ${filename} 默认模板，修改后点击保存即可同步`);
  };

  const isLoading = fileLoadState[activeFile] === 'loading' || fileLoadState[activeFile] === undefined;
  const isLoaded = fileLoadState[activeFile] === 'loaded';
  const currentContent = fileContents[activeFile] ?? '';
  const isEmpty = isLoaded && currentContent.trim() === '';

  return (
    <div className="space-y-6">
      {/* Name */}
      <div className={cn('space-y-4 rounded-2xl p-5', glassSectionSurface)}>
        <h3 className="text-base font-semibold text-foreground">{t('detail.basicInfo')}</h3>
        <div className="space-y-2.5">
          <Label htmlFor="detail-name" className={labelCls}>{t('settingsDialog.nameLabel')}</Label>
          <div className="flex gap-2">
            <Input id="detail-name" value={name} onChange={(e) => setName(e.target.value)}
              readOnly={agent.isDefault} className={inputCls} />
            {!agent.isDefault && (
              <Button variant="outline" onClick={() => void handleSaveName()}
                disabled={savingName || !name.trim() || name.trim() === agent.name}
                className="h-[44px] rounded-md border-glass-border bg-[hsl(var(--glass-bg)/0.5)] px-4 text-[13px] font-medium">
                {savingName ? <RefreshCw className="h-4 w-4 animate-spin" /> : t('common:actions.save')}
              </Button>
            )}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={cn('space-y-1 rounded-xl border border-border p-4', glassNestedCard)}>
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">{t('settingsDialog.agentIdLabel')}</p>
            <p className="font-mono text-[13px] text-foreground break-all">{agent.id}</p>
          </div>
          <div className={cn('space-y-1 rounded-xl border border-border p-4', glassNestedCard)}>
            <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground/80 font-medium">{t('settingsDialog.modelLabel')}</p>
            <p className="text-[13.5px] text-foreground">
              {agent.modelDisplay}{agent.inheritedModel ? ` (${t('inherited')})` : ''}
            </p>
          </div>
        </div>
        <div className="space-y-2.5">
          <Label className={labelCls}>Execution Engine</Label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={(agent.engineType ?? 'openclaw') === 'openclaw' ? 'default' : 'outline'}
              disabled={savingEngine}
              onClick={() => void handleSetEngine('openclaw')}
              className="h-9 rounded-md px-4 text-[13px]"
            >
              OpenClaw
            </Button>
            <Button
              type="button"
              variant={(agent.engineType ?? 'openclaw') === 'claude' ? 'default' : 'outline'}
              disabled={savingEngine}
              onClick={() => void handleSetEngine('claude')}
              className="h-9 rounded-md px-4 text-[13px]"
            >
              Claude Agent
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Claude 适配器骨架已接入；当前仓库策略禁止我自动安装 SDK，切到 Claude 后需要你手动补依赖再完成 adapter。
          </p>
        </div>
      </div>

      {/* Constraint Files */}
      <div className={cn('rounded-2xl p-5 space-y-4', glassSectionSurface)}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('detail.constraintFiles')}</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              文件实时读取自工作空间，保存后立即同步生效
            </p>
          </div>
        </div>

        {/* File tabs */}
        <div className="flex gap-2 flex-wrap">
          {CONSTRAINT_FILES.map((f) => {
            const loaded = fileLoadState[f] === 'loaded';
            const hasContent = loaded && (fileContents[f] ?? '').trim().length > 0;
            return (
              <button key={f} onClick={() => setActiveFile(f as ConstraintFile)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors',
                  activeFile === f
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border bg-transparent text-muted-foreground hover:bg-primary/5 hover:text-foreground',
                  glassNestedCard,
                )}>
                <FileText className="h-3.5 w-3.5" />
                {f}
                {loaded && (
                  <span className={cn(
                    'ml-0.5 h-1.5 w-1.5 rounded-full shrink-0',
                    hasContent ? 'bg-green-500' : 'bg-muted-foreground/40',
                  )} />
                )}
              </button>
            );
          })}
        </div>

        {/* Editor area */}
        <div className="space-y-2">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-[13px]">正在从工作空间读取 {activeFile}...</span>
            </div>
          ) : (
            <>
              {isEmpty && (
                <div className={cn(
                  'flex items-center justify-between rounded-xl border border-dashed border-amber-500/40 bg-amber-50/60 dark:bg-amber-500/5 px-4 py-3',
                )}>
                  <p className="text-[13px] text-amber-700 dark:text-amber-400">
                    <span className="font-semibold">{activeFile}</span> 在工作空间中不存在或内容为空
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleInsertTemplate(activeFile as ConstraintFile)}
                    className="h-7 shrink-0 rounded-md px-3 text-[12px] border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10">
                    <Wand2 className="h-3.5 w-3.5 mr-1" />
                    插入默认模板
                  </Button>
                </div>
              )}
              <Textarea
                value={currentContent}
                onChange={(e) => setFileContents((prev) => ({ ...prev, [activeFile]: e.target.value }))}
                rows={16}
                className="font-mono text-[13px] bg-[hsl(var(--glass-bg)/0.5)] border-glass-border focus-visible:ring-2 focus-visible:ring-ring/40 resize-y rounded-xl leading-relaxed"
                placeholder={`在此输入 ${activeFile} 的内容，保存后会同步到工作空间文件...`}
              />
            </>
          )}
          <div className="flex items-center justify-between">
            <p className="text-[12px] text-muted-foreground">
              {isLoaded && currentContent.length > 0
                ? `${currentContent.length} 字符 · ${currentContent.split('\n').length} 行`
                : ''}
            </p>
            <div className="flex items-center gap-2">
              {isLoaded && !isEmpty && (
                <Button variant="ghost" size="sm"
                  onClick={() => handleInsertTemplate(activeFile as ConstraintFile)}
                  className="h-8 px-3 text-[12px] rounded-md text-muted-foreground hover:text-foreground">
                  <Wand2 className="h-3.5 w-3.5 mr-1" />
                  重置为默认模板
                </Button>
              )}
              <Button variant="outline" size="sm"
                onClick={() => void handleSaveFile(activeFile)}
                disabled={fileSaving[activeFile] || isLoading}
                className="h-8 px-4 text-[13px] rounded-md border-glass-border">
                {fileSaving[activeFile]
                  ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  : <Check className="h-3.5 w-3.5 mr-1.5" />}
                保存并同步到工作空间
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Model Tab ─────────────────────────────────────────────────────────────────

/** A flat model option: may come from account.model or from account.metadata.customModels */
interface ModelOption {
  key: string;          // unique React key
  modelId: string;      // model ID to save
  accountId: string;    // parent account id
  displayName: string;  // shown as primary label
  subLabel: string;     // shown as secondary label
  iconUrl?: string;
  invertDark: boolean;
}

function buildModelOptions(
  providerItems: ReturnType<typeof buildProviderListItems>,
): ModelOption[] {
  const options: ModelOption[] = [];
  for (const { account, vendor } of providerItems) {
    if (HIDDEN_PROVIDER_IDS.has(account.id) || HIDDEN_PROVIDER_IDS.has(account.vendorId)) continue;
    const iconUrl = getProviderIconUrl(account.vendorId);
    const invertDark = shouldInvertInDark(account.vendorId);
    const subLabel = account.label || vendor?.name || account.vendorId;
    const customModels = account.metadata?.customModels;
    if (customModels && customModels.length > 0) {
      // STO-style: expand each model from the catalog as a separate option
      for (const modelId of customModels) {
        if (HIDDEN_PROVIDER_IDS.has(modelId)) continue;
        options.push({
          key: `${account.id}::${modelId}`,
          modelId,
          accountId: account.id,
          displayName: modelId,
          subLabel,
          iconUrl,
          invertDark,
        });
      }
    } else if (account.model) {
      // Single-model account (non-STO)
      if (!HIDDEN_PROVIDER_IDS.has(account.model)) {
        options.push({
          key: account.id,
          modelId: account.model,
          accountId: account.id,
          displayName: account.label || account.id,
          subLabel: account.model,
          iconUrl,
          invertDark,
        });
      }
    }
  }
  return options;
}

function ModelTab({ agent }: { agent: AgentSummary }) {
  const { t } = useTranslation('agents');
  const { accounts, statuses, vendors, defaultAccountId, init } = useProviderStore();
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(agent.modelAccountId);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void init(); }, [init]);

  const providerItems = buildProviderListItems(accounts, statuses, vendors, defaultAccountId);
  const modelOptions = buildModelOptions(providerItems);

  // Always sync selectedModelId from the agent prop whenever agent.modelDisplay changes
  // (e.g. when Chat toolbar switches the model and fetchAgents() refreshes the store).
  // Guard: don't override while a save is in-flight.
  useEffect(() => {
    if (!saving && agent.modelDisplay) {
      setSelectedModelId(agent.modelDisplay);
      setSelectedAccountId(agent.modelAccountId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, agent.modelDisplay, agent.modelAccountId]);

  const handleSave = async () => {
    if (!selectedModelId) return;
    const selectedOption = modelOptions.find((opt) => (
      opt.modelId === selectedModelId && (!selectedAccountId || opt.accountId === selectedAccountId)
    )) ?? modelOptions.find((opt) => opt.modelId === selectedModelId);
    setSaving(true);
    try {
      await hostApiFetch(`/api/agents/${encodeURIComponent(agent.id)}/model`, {
        method: 'PUT',
        body: JSON.stringify({
          model: selectedModelId,
          accountId: selectedOption?.accountId,
        }),
      });
      toast.success(t('detail.modelSaved'));
      // Refresh agents store so Chat toolbar and other views reflect the change
      void fetchAgents();
    } catch (err) {
      toast.error(`保存模型失败: ${String(err)}`);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className={cn('rounded-2xl p-5 space-y-4', glassSectionSurface)}>
        <h3 className="text-base font-semibold text-foreground">{t('detail.currentModel')}</h3>
        <div className={cn('flex items-center gap-3 rounded-xl border border-border p-4', glassNestedCard)}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-foreground">{agent.modelDisplay}</p>
            {agent.inheritedModel && (
              <p className="text-[13px] text-muted-foreground">{t('inherited')} — {t('detail.modelInheritedDesc')}</p>
            )}
          </div>
        </div>
      </div>

      <div className={cn('rounded-2xl p-5 space-y-4', glassSectionSurface)}>
        <h3 className="text-base font-semibold text-foreground">{t('detail.selectModel')}</h3>
        {modelOptions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-[14px] text-muted-foreground">
            <Cpu className="mx-auto mb-3 h-8 w-8 opacity-40" />
            <p>{t('detail.noModelsConfigured')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {modelOptions.map((opt) => {
              const isSelected = selectedModelId === opt.modelId
                && (selectedAccountId ? selectedAccountId === opt.accountId : true);
              return (
                <button
                  key={opt.key}
                  onClick={() => {
                    setSelectedModelId(opt.modelId);
                    setSelectedAccountId(opt.accountId);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-xl border p-4 text-left transition-colors',
                    isSelected
                      ? 'border-primary/30 bg-primary/10'
                      : 'border-border hover:bg-primary/5',
                    glassNestedCard,
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/80 dark:bg-white/10 border border-border">
                    {opt.iconUrl ? (
                      <img
                        src={opt.iconUrl}
                        alt={opt.subLabel}
                        className={cn('h-5 w-5 object-contain', opt.invertDark && 'dark:invert')}
                      />
                    ) : (
                      <Cpu className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-foreground truncate">{opt.displayName}</p>
                    <p className="text-[12px] text-muted-foreground truncate">{opt.subLabel}</p>
                  </div>
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
        {selectedModelId && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-[13px] text-muted-foreground">
              将使用模型: <span className="font-mono font-medium text-foreground">{selectedModelId}</span>
            </p>
            <Button
              onClick={() => void handleSave()}
              disabled={saving}
              className="h-9 rounded-md px-5 text-[13px] font-medium shadow-none"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              {t('common:actions.save')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Skills Tab ────────────────────────────────────────────────────────────────
function SkillsTab({ agentId }: { agentId: string }) {
  const {
    skills, fetchSkills,
    enableSkill, disableSkill,
    stoSearchResults, stoSearching,
    searchStoSkills, installStoSkill, stoInstalling, uninstallStoSkill,
  } = useSkillsStore();
  const [skillsSubTab, setSkillsSubTab] = useState<'enterprise' | 'external'>('enterprise');
  const [stoQuery, setStoQuery] = useState('');

  useEffect(() => { void fetchSkills(); }, [fetchSkills]);

  // Debounced STO search
  useEffect(() => {
    if (skillsSubTab !== 'enterprise') return;
    const timer = setTimeout(() => { void searchStoSkills(stoQuery); }, 300);
    return () => clearTimeout(timer);
  }, [stoQuery, skillsSubTab, searchStoSkills]);

  // Initial STO load on tab switch
  useEffect(() => {
    if (skillsSubTab === 'enterprise') void searchStoSkills('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillsSubTab]);

  // Enterprise (企业内部): skills from the enterprise's own STO platform
  const enterpriseSkills = skills.filter((s) => s.source === 'sto-marketplace');
  // External (外部技能): non-bundled, non-STO skills from external sources (clawhub etc.)
  const externalInstalled = skills.filter(
    (s) => !s.isBundled && s.source !== 'openclaw-bundled' && s.source !== 'sto-marketplace',
  );

  const subTabs = [
    { key: 'enterprise' as const, label: '企业内部' },
    { key: 'external' as const, label: '外部技能' },
  ];

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-0 border-b border-border/40">
        {subTabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSkillsSubTab(key)}
            className={cn(
              'relative -mb-px border-b-2 border-transparent px-5 py-2.5 text-[13px] font-medium transition-colors',
              skillsSubTab === key
                ? 'border-primary text-foreground'
                : 'text-muted-foreground/60 hover:text-foreground/80',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Enterprise Internal ──────────────────────────────────── */}
      {skillsSubTab === 'enterprise' && (
        <div className="space-y-4">
          {/* STO search bar */}
          <div className="relative flex items-center glass rounded-xl px-3 py-2 border border-glass-border">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              placeholder="搜索企业内部技能…"
              value={stoQuery}
              onChange={(e) => setStoQuery(e.target.value)}
              className="ml-2 bg-transparent outline-none flex-1 text-[13px] text-foreground placeholder:text-foreground/40"
            />
            {stoQuery && (
              <button type="button" onClick={() => setStoQuery('')} className="text-foreground/50 hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Installed STO skills */}
          {enterpriseSkills.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] text-muted-foreground/60 font-medium">已安装</p>
              {enterpriseSkills.map((skill) => (
                <div key={skill.id} className={cn('flex items-center gap-3 rounded-xl border border-border p-3', glassNestedCard)}>
                  <span className="text-xl leading-none shrink-0">{skill.icon || '🧩'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-foreground truncate">{skill.name}</p>
                    <p className="text-[12px] text-muted-foreground truncate">{skill.description}</p>
                  </div>
                  <Switch
                    size="sm"
                    checked={skill.enabled}
                    disabled={skill.isCore}
                    onCheckedChange={async (checked) => {
                      try {
                        if (checked) await enableSkill(skill.id);
                        else await disableSkill(skill.id);
                      } catch (err) { toast.error(String(err)); }
                    }}
                  />
                  {skill.slug && (
                    <Button variant="ghost" size="sm"
                      className="h-7 px-2 text-[11px] text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                      onClick={async () => {
                        try { await uninstallStoSkill(skill.slug!, agentId); toast.success('已卸载'); }
                        catch (err) { toast.error(String(err)); }
                      }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* STO marketplace search results */}
          {stoSearching ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : stoSearchResults.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[12px] text-muted-foreground/60 font-medium">技能广场</p>
              {stoSearchResults.map((s) => {
                const isInstalled = skills.some(
                  (sk) =>
                    (sk.slug && sk.slug.toLowerCase() === s.slug.toLowerCase()) ||
                    sk.id.toLowerCase() === s.slug.toLowerCase(),
                );
                const installing = stoInstalling[s.slug];
                return (
                  <div key={s.slug} className={cn('flex items-center gap-3 rounded-xl border border-border p-3', glassNestedCard)}>
                    <span className="text-xl leading-none shrink-0">🧩</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground truncate">{s.name}</p>
                      {s.author && <p className="text-[11px] text-muted-foreground/70">by {s.author}</p>}
                      <p className="text-[11px] text-muted-foreground truncate">{s.description}</p>
                    </div>
                    {isInstalled ? (
                      <Badge variant="secondary" className="shrink-0 text-[11px]">已安装</Badge>
                    ) : (
                      <Button size="sm" variant="outline" disabled={installing}
                        onClick={() => void installStoSkill(s.slug, s.version, { name: s.name, description: s.description, author: s.author }, agentId)}
                        className="h-7 shrink-0 rounded-md px-3 text-[12px]">
                        {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                        安装
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Puzzle className="h-10 w-10 mb-4 opacity-40" />
              <p className="text-[13px]">{stoQuery ? '未找到相关技能' : '搜索 STO 平台技能'}</p>
            </div>
          )}
        </div>
      )}

      {/* ── External Skills ──────────────────────────────────────── */}
      {skillsSubTab === 'external' && (
        <div className="space-y-2">
          {externalInstalled.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Puzzle className="h-10 w-10 mb-4 opacity-40" />
              <p className="text-[14px]">暂无外部技能</p>
            </div>
          ) : (
            externalInstalled.map((skill) => (
              <div key={skill.id} className={cn('flex items-center gap-3 rounded-xl border border-border p-3', glassNestedCard)}>
                <span className="text-xl leading-none shrink-0">{skill.icon || '📦'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-foreground truncate">{skill.name}</p>
                  <p className="text-[12px] text-muted-foreground truncate">{skill.description}</p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-[11px]">{skill.source || 'managed'}</Badge>
                <Switch
                  size="sm"
                  checked={skill.enabled}
                  disabled={skill.isCore}
                  onCheckedChange={async (checked) => {
                    try {
                      if (checked) await enableSkill(skill.id);
                      else await disableSkill(skill.id);
                    } catch (err) { toast.error(String(err)); }
                  }}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Channels Tab ──────────────────────────────────────────────────────────────
interface ChannelAccountItem {
  accountId: string;
  name: string;
  configured: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError?: string;
  isDefault: boolean;
  agentId?: string;
}
interface ChannelGroupItem {
  channelType: string;
  defaultAccountId: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  accounts: ChannelAccountItem[];
}

function ChannelsTab({ agent }: { agent: AgentSummary }) {
  const [channels, setChannels] = useState<ChannelGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfig, setShowConfig] = useState(false);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hostApiFetch<{ success: boolean; channels?: ChannelGroupItem[] }>('/api/channels/accounts');
      setChannels(res.channels ?? []);
    } catch { setChannels([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchChannels(); }, [fetchChannels]);

  const dingtalkGroup = channels.find((g) => g.channelType === 'dingtalk');
  const agentAccounts = dingtalkGroup?.accounts.filter((a) => a.agentId === agent.id) ?? [];

  const statusColor = (s: string) => {
    if (s === 'connected') return 'bg-green-500';
    if (s === 'connecting') return 'bg-yellow-500 animate-pulse';
    if (s === 'error') return 'bg-destructive';
    return 'bg-muted-foreground';
  };

  return (
    <div className="space-y-5">
      <div className={cn('rounded-2xl p-5 space-y-4', glassSectionSurface)}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">钉钉频道</h3>
          <Button size="sm" variant="outline"
            className="h-8 rounded-md border-glass-border text-[13px] px-3"
            onClick={() => setShowConfig(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />配置
          </Button>
        </div>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><LoadingSpinner /></div>
        ) : (
          <div className="space-y-3">
            {/* DingTalk channel card */}
            <div className={cn('flex items-center justify-between rounded-xl border border-border p-4', glassNestedCard)}>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10">
                  <img src={dingtalkIcon} alt="DingTalk" className="w-5 h-5 dark:invert" />
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-foreground">{CHANNEL_NAMES['dingtalk'] || '钉钉'}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {agentAccounts.length > 0 ? `已绑定 ${agentAccounts.length} 个账号` : '未绑定'}
                  </p>
                </div>
              </div>
              {dingtalkGroup && (
                <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', statusColor(dingtalkGroup.status))} />
              )}
            </div>

            {/* Bound accounts */}
            {agentAccounts.length > 0 && (
              <div className="space-y-2 pl-2">
                {agentAccounts.map((acc) => (
                  <div key={acc.accountId}
                    className={cn('flex items-center justify-between rounded-xl border border-border p-3', glassNestedCard)}>
                    <div className="flex items-center gap-2">
                      <div className={cn('h-2 w-2 rounded-full shrink-0', statusColor(acc.status))} />
                      <p className="text-[13.5px] font-medium text-foreground">
                        {acc.accountId === 'default' ? '主账号' : acc.name || acc.accountId}
                      </p>
                    </div>
                    {acc.lastError && (
                      <p className="text-xs text-destructive truncate max-w-[200px]">{acc.lastError}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {agentAccounts.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <MessagesSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                <p className="text-[14px] text-muted-foreground">该智能体尚未绑定钉钉频道</p>
                <p className="text-[13px] text-muted-foreground/70 mt-1">点击"配置"按钮，扫码完成钉钉对接</p>
              </div>
            )}
          </div>
        )}
      </div>

      {showConfig && (
        <ChannelConfigModal
          initialSelectedType="dingtalk"
          agentId={agent.id}
          showChannelName={false}
          allowExistingConfig={false}
          onClose={() => { setShowConfig(false); void fetchChannels(); }}
          onChannelSaved={() => { void fetchChannels(); }}
        />
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
interface AgentDetailPageProps {
  agent: AgentSummary;
  onBack: () => void;
}

export function AgentDetailPage({ agent, onBack }: AgentDetailPageProps) {
  const { t } = useTranslation('agents');
  const [tab, setTab] = useState('info');
  const hiddenTabs = new Set(['skills']);

  const tabs = [
    { value: 'info', label: t('detail.tabInfo'), icon: <FileText className="h-4 w-4" /> },
    { value: 'model', label: t('detail.tabModel'), icon: <Cpu className="h-4 w-4" /> },
    { value: 'skills', label: t('detail.tabSkills'), icon: <Puzzle className="h-4 w-4" /> },
    { value: 'channels', label: t('detail.tabChannels'), icon: <MessagesSquare className="h-4 w-4" /> },
  ];

  return (
    <div className={cn(stoMainInnerShell, 'flex flex-col gap-6 pb-10')}>
      {/* Header */}
      <header className="shrink-0 border-b border-border pb-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon"
            onClick={onBack}
            className="mt-0.5 h-9 w-9 shrink-0 rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-primary/[0.08] text-primary shadow-[var(--sto-shadow-brand-icon)]">
              <Bot className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-[1.65rem] truncate">
                  {agent.name}
                </h1>
                {agent.isDefault && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/14 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-100">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    {t('runningBadge')}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground font-mono">{agent.id}</p>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex h-auto w-full items-stretch gap-0 rounded-none border-t-0 border-x-0 border-b border-border/40 bg-transparent p-0">
          {tabs.filter((tb) => !hiddenTabs.has(tb.value)).map((tb) => (
            <TabsTrigger key={tb.value} value={tb.value}
              className={cn(
                'group relative -mb-px flex items-center gap-2 rounded-none border-b-2 border-transparent bg-transparent px-5 py-3 text-[13px] font-medium text-muted-foreground/60 transition-colors duration-150',
                'hover:bg-transparent hover:text-foreground/80',
                'data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
              )}>
              <span className="transition-colors duration-150 group-data-[state=active]:text-primary">
                {tb.icon}
              </span>
              {tb.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="info" forceMount className={tab !== 'info' ? 'hidden' : ''}>
            <InfoTab agent={agent} />
          </TabsContent>
          <TabsContent value="model" forceMount className={tab !== 'model' ? 'hidden' : ''}>
            <ModelTab agent={agent} />
          </TabsContent>
          <TabsContent value="skills" forceMount className={tab !== 'skills' ? 'hidden' : ''}>
            <SkillsTab agentId={agent.id} />
          </TabsContent>
          <TabsContent value="channels" forceMount className={tab !== 'channels' ? 'hidden' : ''}>
            <ChannelsTab agent={agent} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default AgentDetailPage;
