import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SclawCapabilityRegistry,
  SclawExtensionStateManager,
  type SclawExtensionLogger,
} from '../../shared/agent-extensions';
import { DINGTALK_RECIPIENTS_MARKER } from '../../shared/dingtalk-send/dingtalk-mention';
import { buildClaudeAgentExtensions } from '../../electron/agent-extensions/adapters/claude';
import { buildPiAgentExtensions } from '../../electron/agent-extensions/adapters/pi';
import {
  STO_DINGTALK_SEND_GUARD_CAPABILITY,
  type DingTalkPendingContext,
  type StoDingTalkSendGuardPort,
} from '../../electron/agent-extensions/extensions/sto-dingtalk-send-guard/capability';
import {
  classifyDingTalkSend,
  resolveDingTalkSendStaticProblem,
} from '../../electron/agent-extensions/extensions/sto-dingtalk-send-guard/command';
import { stoDingTalkSendGuardDefinition } from '../../electron/agent-extensions/extensions/sto-dingtalk-send-guard/definition';
import {
  completeDingTalkSend,
  reserveDingTalkSend,
  resetDingTalkSendGuardStateForTests,
} from '../../electron/utils/dingtalk-send-guard-state';

const logger: SclawExtensionLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function createDependencies(pending: DingTalkPendingContext | null = null) {
  const port: StoDingTalkSendGuardPort = {
    hasPendingContext: vi.fn(async () => pending !== null),
    consumePendingContext: vi.fn(async () => pending),
    reserveSend: vi.fn(async () => ({ allowed: true })),
    completeSend: vi.fn(async () => undefined),
  };
  return {
    port,
    capabilities: new SclawCapabilityRegistry()
      .provide(STO_DINGTALK_SEND_GUARD_CAPABILITY, port),
    stateManager: new SclawExtensionStateManager(),
    logger,
  };
}

function preToolInput(toolCallId: string, command: string) {
  return {
    hook_event_name: 'PreToolUse' as const,
    session_id: 'sdk-session',
    transcript_path: 'transcript.jsonl',
    cwd: 'D:/workspace',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: toolCallId,
  };
}

describe('sto DingTalk send guard common extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDingTalkSendGuardStateForTests();
  });

  it('compiles the same prompt and policy into Claude', async () => {
    const dependencies = createDependencies({
      sessionKey: 'claude-dingtalk',
      mentions: [{ type: 'user', displayName: '张三', userId: 'u-001' }],
      userText: '发给张三',
      writtenAt: Date.now(),
    });
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'claude-dingtalk',
      mode: 'interactive',
      userPrompt: '发给张三',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.options.systemPromptAppend).toContain(DINGTALK_RECIPIENTS_MARKER);
    expect(result.options.systemPromptAppend).toContain('u-001');
    expect(result.options.mcpServers).toBeUndefined();

    const preTool = result.options.hooks?.PreToolUse?.[0]?.hooks[0] as HookCallback;
    const denied = await preTool(preToolInput(
      'batch',
      'for i in 1 2; do dws chat message send --user u1 --text hello --format json; done',
    ), 'batch', { signal: new AbortController().signal });
    expect(denied.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });

    const allowed = await preTool(preToolInput(
      'single',
      'dws chat message send --user u1 --text "hello" --format json',
    ), 'single', { signal: new AbortController().signal });
    expect(allowed.hookSpecificOutput).toMatchObject({
      hookEventName: 'PreToolUse',
      updatedInput: { command: expect.stringContaining('dws chat message send') },
    });
    expect(dependencies.port.reserveSend).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey: 'claude-dingtalk',
      toolCallId: 'single',
      category: 'text',
      scheduledExecution: false,
    }));

    const postTool = result.options.hooks?.PostToolUse?.[0]?.hooks[0] as HookCallback;
    await postTool({
      hook_event_name: 'PostToolUse',
      session_id: 'sdk-session',
      transcript_path: 'transcript.jsonl',
      cwd: 'D:/workspace',
      tool_name: 'Bash',
      tool_input: { command: 'dws chat message send --user u1 --text "hello" --format json' },
      tool_response: { stdout: '{"ok":true,"openTaskId":"t1"}' },
      tool_use_id: 'single',
    }, 'single', { signal: new AbortController().signal });
    expect(dependencies.port.completeSend).toHaveBeenCalledWith({
      sessionKey: 'claude-dingtalk',
      toolCallId: 'single',
      success: true,
    });
  });

  it('treats a pending attachment as explicit send intent', async () => {
    const dependencies = createDependencies({
      sessionKey: 'claude-dingtalk-file',
      mentions: [{ type: 'user', displayName: '张三', userId: 'u-001' }],
      userText: '这个文件',
      writtenAt: Date.now(),
      sendFileIntent: true,
      attachedFiles: [{
        fileName: 'report.pdf',
        filePath: 'D:/workspace/report.pdf',
        mimeType: 'application/pdf',
      }],
    });
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'claude-dingtalk-file',
      mode: 'interactive',
      userPrompt: '这个文件',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });

    expect(result.options.systemPromptAppend).toContain('在线链接流程');
    expect(result.options.systemPromptAppend).toContain('upload_file_to_temp_oss');
    expect(result.options.systemPromptAppend).not.toContain('本轮禁止发送');
  });

  it('treats command-style content sent to a selected group as explicit send intent', async () => {
    const userPrompt = '看一下最近三日上海天气情况，发送天气数据和截图到群聊 @Claw客户端开发测试群';
    const dependencies = createDependencies({
      sessionKey: 'claude-dingtalk-weather-send',
      mentions: [{
        type: 'group',
        displayName: 'Claw客户端开发测试群',
        openConversationId: 'cid-test-group',
      }],
      userText: userPrompt,
      writtenAt: Date.now(),
    });
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'claude-dingtalk-weather-send',
      mode: 'interactive',
      userPrompt,
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });

    expect(result.options.systemPromptAppend).toContain('对话 @ 且用户已明确要求发送');
    expect(result.options.systemPromptAppend).toContain('upload_file_to_temp_oss');
    expect(result.options.systemPromptAppend).not.toContain('本轮默认禁止发送');
    expect(result.options.systemPromptAppend).not.toContain('本轮禁止发送');
  });

  it('injects the direct DingTalk Drive branch when explicitly requested', async () => {
    const dependencies = createDependencies({
      sessionKey: 'claude-dingtalk-drive',
      mentions: [{ type: 'user', displayName: '张三', userId: 'u-001' }],
      userText: '把报告上传到钉盘再发给张三',
      writtenAt: Date.now(),
      sendFileIntent: true,
      attachedFiles: [{
        fileName: 'report.pdf',
        filePath: 'D:/workspace/report.pdf',
        mimeType: 'application/pdf',
      }],
    });
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'claude-dingtalk-drive',
      mode: 'interactive',
      userPrompt: '把报告上传到钉盘再发给张三',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });

    expect(result.options.systemPromptAppend).toContain('用户已明确要求上传到钉盘/钉钉云盘');
    expect(result.options.systemPromptAppend).toContain('禁止调用 `upload_file_to_temp_oss`');
    expect(result.options.systemPromptAppend).not.toContain('1. 优先调用 Agent 工具');
  });

  it('keeps an OSS Markdown image in the text rate-limit bucket', () => {
    const command = 'dws chat message send --user u1 --title "图片" --text "![截图](https://oss.example/a.png?token=1)" --format json';
    expect(classifyDingTalkSend(command)).toBe('text');
  });

  it('compiles prompt, patching, and completion into PI without registering a tool', async () => {
    const dependencies = createDependencies();
    const result = await buildPiAgentExtensions({
      sessionKey: 'pi-dingtalk',
      mode: 'interactive',
      userPrompt: '帮我发钉钉',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });
    expect(result.initiallyActiveToolNames).toEqual([]);

    type Handler = (event: Record<string, unknown>) => Promise<unknown> | unknown;
    const handlers = new Map<string, Handler>();
    const extension = result.extensions.find(
      (item) => typeof item !== 'function' && item.name === 'sto-dingtalk-send-guard',
    );
    if (!extension || typeof extension === 'function') throw new Error('missing DingTalk extension');
    await extension.factory({
      registerTool() {},
      on(event, handler) { handlers.set(event, handler as Handler); },
    } as never);

    const prompt = await handlers.get('before_agent_start')?.({
      prompt: '帮我发钉钉', systemPrompt: 'base', systemPromptOptions: {},
    }) as { systemPrompt?: string } | undefined;
    expect(prompt?.systemPrompt).toContain('base');
    expect(prompt?.systemPrompt).toContain('dws chat message send');

    const input = {
      command: 'dws chat message send --user u1 --text "hello" --format json',
      timeout: 30,
    };
    await expect(handlers.get('tool_call')?.({
      toolName: 'bash', toolCallId: 'pi-send', input,
    })).resolves.toBeUndefined();
    expect(input.command).toContain('dws chat message send');
    expect(input.timeout).toBe(30);
    expect(dependencies.port.reserveSend).toHaveBeenCalledOnce();

    await handlers.get('tool_result')?.({
      toolName: 'bash',
      toolCallId: 'pi-send',
      input,
      content: [{ type: 'text', text: '{"ok":true,"openTaskId":"t1"}' }],
      details: { stdout: '{"ok":true,"openTaskId":"t1"}' },
      isError: false,
    });
    expect(dependencies.port.completeSend).toHaveBeenCalledWith(expect.objectContaining({
      toolCallId: 'pi-send', success: true,
    }));
  });

  it('keeps the safety policy installed while leaving the prompt inactive for unrelated chat', async () => {
    const dependencies = createDependencies();
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'unrelated',
      mode: 'interactive',
      userPrompt: '帮我分析这个项目',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });

    expect(result.options.systemPromptAppend).toBeUndefined();
    expect(result.options.hooks?.PreToolUse).toHaveLength(1);
    expect(dependencies.port.consumePendingContext).not.toHaveBeenCalled();
  });

  it('keeps keyword activation for follow-up turns in the same session', async () => {
    const dependencies = createDependencies();
    const first = await buildClaudeAgentExtensions({
      sessionKey: 'follow-up',
      mode: 'interactive',
      userPrompt: '帮我发一条钉钉消息',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });
    const second = await buildClaudeAgentExtensions({
      sessionKey: 'follow-up',
      mode: 'interactive',
      userPrompt: '改成发给李四',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });

    expect(first.options.systemPromptAppend).toContain('dws chat message send');
    expect(second.options.systemPromptAppend).toContain('dws chat message send');
    expect(dependencies.port.hasPendingContext).toHaveBeenCalledTimes(0);
  });

  it('activates for an explicit oral send request without naming DingTalk', async () => {
    const dependencies = createDependencies();
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'oral-send',
      mode: 'interactive',
      userPrompt: '把今天的报告发给张三',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      ...dependencies,
    });

    expect(result.options.systemPromptAppend).toContain('dws chat message send');
    expect(result.options.systemPromptAppend).toContain('upload_file_to_temp_oss');
    expect(result.options.systemPromptAppend).toContain('![文件名](在线地址)');
    expect(result.options.systemPromptAppend).toContain('[文件名](在线地址)');
    expect(result.options.systemPromptAppend).toContain('明确要求上传/保存到钉盘');
  });

  it('reports a missing capability instead of partially installing the guard', async () => {
    const result = await buildClaudeAgentExtensions({
      sessionKey: 'missing-capability',
      mode: 'interactive',
      entries: [{ common: stoDingTalkSendGuardDefinition }],
      capabilities: new SclawCapabilityRegistry(),
      stateManager: new SclawExtensionStateManager(),
      logger,
    });
    expect(result.options).toEqual({});
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'MISSING_CAPABILITY',
      contributionId: 'sto.dingtalk-send-guard',
    }));
  });

  it('keeps ordinary interval limiting disabled while preserving successful-send deduplication', () => {
    const first = reserveDingTalkSend({
      sessionKey: 'session-1', toolCallId: 'first', category: 'text',
      recipientKey: 'user:u1', normalizedText: 'hello', scheduledExecution: false, now: 1_000,
    });
    expect(first).toEqual({ allowed: true });
    expect(reserveDingTalkSend({
      sessionKey: 'session-1', toolCallId: 'rate', category: 'text',
      recipientKey: 'user:u2', normalizedText: 'different', scheduledExecution: false, now: 2_000,
    })).toEqual({ allowed: true });

    completeDingTalkSend({
      sessionKey: 'session-1', toolCallId: 'first', success: true, now: 2_000,
    });
    expect(reserveDingTalkSend({
      sessionKey: 'scheduled', toolCallId: 'duplicate', category: 'text',
      recipientKey: 'user:u1', normalizedText: 'hello', scheduledExecution: true, now: 25_000,
    })).toMatchObject({ allowed: false, code: 'duplicate' });
    expect(reserveDingTalkSend({
      sessionKey: 'scheduled', toolCallId: 'scheduled-ok', category: 'text',
      recipientKey: 'user:u2', normalizedText: 'different', scheduledExecution: true, now: 25_000,
    })).toEqual({ allowed: true });
  });
});

describe('resolveDingTalkSendStaticProblem', () => {
  it('blocks shell heredoc --text payloads', () => {
    const command =
      "dws chat message send --user xxx --text $(cat <<'EOF'\n# 标题\nEOF)";
    const problem = resolveDingTalkSendStaticProblem(command);
    expect(problem).toContain('heredoc');
    expect(problem).toContain('--text');
  });

  it('blocks leftover I + CJK heading after shell ate #', () => {
    const command = 'dws chat message send --user xxx --text "I 标题"';
    const problem = resolveDingTalkSendStaticProblem(command);
    expect(problem).toContain('I 中文');
    expect(problem).toContain('#');
  });

  it('allows quoted markdown headings and ordinary text', () => {
    expect(
      resolveDingTalkSendStaticProblem(
        'dws chat message send --user xxx --text "### 标题\\n\\n正文"',
      ),
    ).toBeNull();
    expect(
      resolveDingTalkSendStaticProblem(
        'dws chat message send --user xxx --text "正常消息"',
      ),
    ).toBeNull();
    expect(
      resolveDingTalkSendStaticProblem(
        'dws chat message send --user xxx --text "I like this"',
      ),
    ).toBeNull();
  });

  it('allows DingTalk colorTokenV2 font markup', () => {
    expect(
      resolveDingTalkSendStaticProblem(
        'dws chat message send --user xxx --text "<font colorTokenV2=common_blue1_color>蓝色</font> 正文"',
      ),
    ).toBeNull();
  });

  it('blocks general or malformed font markup', () => {
    expect(
      resolveDingTalkSendStaticProblem(
        `dws chat message send --user xxx --text '<font color="#FF0000">红色</font>'`,
      ),
    ).toContain('colorTokenV2');
    expect(
      resolveDingTalkSendStaticProblem(
        `dws chat message send --user xxx --text '<font colorTokenV2="common_red1_color">红色</font>'`,
      ),
    ).toContain('带引号');
    expect(
      resolveDingTalkSendStaticProblem(
        'dws chat message send --user xxx --text "<font colorTokenV2=common_red1_color>红色"',
      ),
    ).toContain('成对');
  });
});
