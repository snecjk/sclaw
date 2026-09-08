import { describe, expect, it } from 'vitest';
import type { ToolStatus } from '@/stores/chat';
import {
  appDevCompletedToolsSignature,
  appDevFileOpVerb,
  appDevToolBaseName,
  buildAppDevLineDiff,
  classifyAppDevTool,
  countAppDevLines,
  describeAppDevTool,
  diffAppDevLineCounts,
  extractAppDevFileOpStat,
  formatAppDevDurationMs,
  isAppDevToolRollupEmpty,
  normalizeAppDevTimestamp,
  resolveAppDevTurnDurationMs,
  resolveAppDevTurnTools,
  rollupAppDevTools,
} from '@/lib/app-dev-tool-rollup';
import { writeTurnStreamingToolsCache } from '@/lib/thinking-turn-tools-cache';

function makeTool(partial: Partial<ToolStatus> & { name: string }): ToolStatus {
  return {
    status: 'completed',
    updatedAt: 1_000,
    ...partial,
  };
}

describe('classifyAppDevTool 工具归类', () => {
  it('按名称归类文件操作 / 命令 / 读取 / 其他', () => {
    expect(classifyAppDevTool('Edit')).toBe('file');
    expect(classifyAppDevTool('MultiEdit')).toBe('file');
    expect(classifyAppDevTool('multi_edit')).toBe('file');
    expect(classifyAppDevTool('Write')).toBe('file');
    expect(classifyAppDevTool('Bash')).toBe('command');
    expect(classifyAppDevTool('run_command')).toBe('command');
    expect(classifyAppDevTool('Read')).toBe('read');
    expect(classifyAppDevTool('Grep')).toBe('read');
    expect(classifyAppDevTool('WebSearch')).toBe('read');
    expect(classifyAppDevTool('ask_followup_question')).toBe('other');
  });
});

describe('countAppDevLines / diffAppDevLineCounts 行数统计', () => {
  it('统计文本行数（结尾换行不多计）', () => {
    expect(countAppDevLines('')).toBe(0);
    expect(countAppDevLines('a')).toBe(1);
    expect(countAppDevLines('a\nb')).toBe(2);
    expect(countAppDevLines('a\nb\n')).toBe(2);
  });

  it('编辑增删按公共前后缀裁剪，与 git numstat 同口径', () => {
    expect(diffAppDevLineCounts('a\nb\nc', 'a\nx\nc')).toEqual({ added: 1, removed: 1 });
    expect(diffAppDevLineCounts('a\nc', 'a\nb\nc')).toEqual({ added: 1, removed: 0 });
    expect(diffAppDevLineCounts('a\nb\nc', 'a\nc')).toEqual({ added: 0, removed: 1 });
    expect(diffAppDevLineCounts('same', 'same')).toEqual({ added: 0, removed: 0 });
    expect(diffAppDevLineCounts('', 'new\nblock')).toEqual({ added: 2, removed: 0 });
  });

  it('buildAppDevLineDiff 产出 same/del/add 行', () => {
    expect(buildAppDevLineDiff('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
    ]);
  });
});

describe('extractAppDevFileOpStat 单工具行数提取', () => {
  it('Edit：old_string/new_string 计增删', () => {
    const stat = extractAppDevFileOpStat(makeTool({
      name: 'Edit',
      input: { file_path: '/app/src/pages/home.page.json', old_string: 'a\nb\nc', new_string: 'a\nx\ny\nc' },
    }));
    expect(stat).toEqual({
      path: '/app/src/pages/home.page.json',
      added: 2,
      removed: 1,
      isCreate: false,
      edits: [{ oldText: 'a\nb\nc', newText: 'a\nx\ny\nc' }],
    });
  });

  it('MultiEdit：edits[] 逐项求和', () => {
    const stat = extractAppDevFileOpStat(makeTool({
      name: 'MultiEdit',
      input: {
        file_path: '/app/a.ts',
        edits: [
          { old_string: 'a', new_string: 'a\nb' },
          { old_string: 'x\ny', new_string: 'x' },
        ],
      },
    }));
    expect(stat).toEqual({
      path: '/app/a.ts',
      added: 1,
      removed: 1,
      isCreate: false,
      edits: [
        { oldText: 'a', newText: 'a\nb' },
        { oldText: 'x\ny', newText: 'x' },
      ],
    });
  });

  it('Write：content 全计 +', () => {
    const stat = extractAppDevFileOpStat(makeTool({
      name: 'Write',
      input: { file_path: '/app/b.ts', content: 'l1\nl2\nl3\n' },
    }));
    expect(stat).toEqual({
      path: '/app/b.ts',
      added: 3,
      removed: 0,
      isCreate: true,
      edits: [{ oldText: '', newText: 'l1\nl2\nl3\n' }],
    });
  });

  it('input 为 JSON 字符串时解析；不完整 JSON 跳过行数统计', () => {
    const parsed = extractAppDevFileOpStat(makeTool({
      name: 'Edit',
      input: JSON.stringify({ file_path: '/app/c.ts', old_string: 'a', new_string: 'a\nb' }),
    }));
    expect(parsed?.added).toBe(1);

    const broken = extractAppDevFileOpStat(makeTool({
      name: 'Edit',
      input: '{"file_path":"/app/c.ts","old_string":"a",',
    }));
    expect(broken).toBeNull();
  });
});

describe('rollupAppDevTools 聚合', () => {
  it('只统计 completed 工具，同文件合并', () => {
    const rollup = rollupAppDevTools([
      makeTool({ name: 'Edit', input: { file_path: '/app/home.page.json', old_string: 'a\nb', new_string: 'a\nx\ny' } }),
      makeTool({ name: 'Edit', input: { file_path: '/app/home.page.json', old_string: 'c', new_string: 'c\nd' } }),
      makeTool({ name: 'Write', input: { file_path: '/app/new.ts', content: '1\n2' } }),
      makeTool({ name: 'Bash', input: { command: 'pnpm run build' } }),
      makeTool({ name: 'Read', input: { file_path: '/app/a.ts' } }),
      makeTool({ name: 'unknown_tool', input: {} }),
      makeTool({ name: 'Edit', status: 'running', input: { file_path: '/app/skip.ts', old_string: 'a', new_string: 'b' } }),
      makeTool({ name: 'Edit', status: 'error', input: { file_path: '/app/skip2.ts', old_string: 'a', new_string: 'b' } }),
    ]);

    expect(rollup.totals.completedTools).toBe(6);
    expect(rollup.files).toHaveLength(2);
    expect(rollup.files[0]).toMatchObject({ path: '/app/home.page.json', added: 3, removed: 1, ops: 2 });
    expect(rollup.files[0]!.edits.length).toBeGreaterThan(0);
    expect(rollup.files[1]).toMatchObject({ path: '/app/new.ts', added: 2, removed: 0, ops: 1, hasCreate: true });
    expect(rollup.files[1]!.edits).toEqual([{ oldText: '', newText: '1\n2' }]);
    expect(rollup.totals.added).toBe(5);
    expect(rollup.totals.removed).toBe(1);
    expect(rollup.commands).toEqual([{ cmd: 'pnpm run build' }]);
    expect(rollup.reads).toBe(1);
    expect(rollup.others).toBe(1);
    expect(isAppDevToolRollupEmpty(rollup)).toBe(false);
  });

  it('空工具列表为空聚合', () => {
    expect(isAppDevToolRollupEmpty(rollupAppDevTools([]))).toBe(true);
  });

  it('命令取首行并截断', () => {
    const long = `pnpm install\n${'x'.repeat(100)}`;
    const rollup = rollupAppDevTools([makeTool({ name: 'Bash', input: { command: long } })]);
    expect(rollup.commands[0]!.cmd).toBe('pnpm install');

    const singleLong = 'y'.repeat(100);
    const rollup2 = rollupAppDevTools([makeTool({ name: 'Bash', input: { command: singleLong } })]);
    expect(rollup2.commands[0]!.cmd).toHaveLength(60);
    expect(rollup2.commands[0]!.cmd.endsWith('…')).toBe(true);
  });
});

describe('appDevCompletedToolsSignature memo 签名', () => {
  it('只随 completed 子集变化', () => {
    const base = [
      makeTool({ name: 'Edit', toolCallId: 't1', updatedAt: 100 }),
      makeTool({ name: 'Read', toolCallId: 't2', status: 'running', updatedAt: 200 }),
    ];
    const sig1 = appDevCompletedToolsSignature(base);
    // running 工具的 updatedAt 变化不影响签名
    const sig2 = appDevCompletedToolsSignature([
      base[0]!,
      makeTool({ name: 'Read', toolCallId: 't2', status: 'running', updatedAt: 300 }),
    ]);
    expect(sig1).toBe(sig2);
    // 新增 completed 工具改变签名
    const sig3 = appDevCompletedToolsSignature([
      ...base,
      makeTool({ name: 'Write', toolCallId: 't3', updatedAt: 400 }),
    ]);
    expect(sig3).not.toBe(sig1);
  });
});

describe('formatAppDevDurationMs / resolveAppDevTurnDurationMs 耗时', () => {
  it('格式化：<60s 秒级，≥60s  Xm Xs', () => {
    expect(formatAppDevDurationMs(24_000)).toBe('24s');
    expect(formatAppDevDurationMs(65_000)).toBe('1m 5s');
    expect(formatAppDevDurationMs(60_000)).toBe('1m');
    expect(formatAppDevDurationMs(-5)).toBe('0s');
  });

  it('优先 anchorAt → 最后工具 updatedAt', () => {
    const duration = resolveAppDevTurnDurationMs({
      anchorAt: 10_000,
      tools: [
        { updatedAt: 20_000, durationMs: 3_000 },
        { updatedAt: 34_000, durationMs: 2_000 },
      ],
    });
    expect(duration).toBe(24_000);
  });

  it('无 anchor 退回工具窗口，再退回 endedAt；无数据返回 null', () => {
    expect(resolveAppDevTurnDurationMs({
      tools: [{ updatedAt: 20_000, durationMs: 5_000 }],
    })).toBe(5_000);
    expect(resolveAppDevTurnDurationMs({ anchorAt: 1_000, endedAt: 4_000 })).toBe(3_000);
    expect(resolveAppDevTurnDurationMs({})).toBeNull();
    expect(resolveAppDevTurnDurationMs({ anchorAt: 5_000, endedAt: 5_000 })).toBeNull();
  });

  it('normalizeAppDevTimestamp 兼容秒级与字符串', () => {
    expect(normalizeAppDevTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeAppDevTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(normalizeAppDevTimestamp('2026-09-03T00:00:00.000Z')).toBe(Date.parse('2026-09-03T00:00:00.000Z'));
    expect(normalizeAppDevTimestamp(undefined)).toBeNull();
  });
});

describe('describeAppDevTool / 动词与文件名', () => {
  it('生成中文一行描述', () => {
    expect(describeAppDevTool(makeTool({
      name: 'Edit',
      input: { file_path: '/app/src/pages/home.page.json', old_string: 'a', new_string: 'b' },
    }))).toBe('编辑 home.page.json');
    expect(describeAppDevTool(makeTool({
      name: 'Write',
      input: { file_path: '/app/new.ts', content: 'x' },
    }))).toBe('创建 new.ts');
    expect(describeAppDevTool(makeTool({ name: 'Bash', input: { command: 'pnpm run build' } }))).toBe('执行 pnpm run build');
    expect(describeAppDevTool(makeTool({ name: 'Read', input: { file_path: '/app/a.ts' } }))).toBe('读取 a.ts');
    expect(describeAppDevTool(makeTool({ name: 'unknown_tool' }))).toBe('unknown_tool');
  });

  it('appDevToolBaseName / appDevFileOpVerb', () => {
    expect(appDevToolBaseName('/app/src/pages/home.page.json')).toBe('home.page.json');
    expect(appDevToolBaseName('C:\\app\\a.ts')).toBe('a.ts');
    expect(appDevFileOpVerb({ hasCreate: true, hasEdit: false })).toBe('创建');
    expect(appDevFileOpVerb({ hasCreate: true, hasEdit: true })).toBe('编辑');
    expect(appDevFileOpVerb({ hasCreate: false, hasEdit: true })).toBe('编辑');
  });
});

describe('resolveAppDevTurnTools 完成轮次工具来源', () => {
  it('命中 streamingTools 缓存', () => {
    const cacheKey = 'test-session::turn-user-cache-hit';
    writeTurnStreamingToolsCache(cacheKey, [
      { toolCallId: 't1', name: 'Edit', input: { file_path: '/a.ts', old_string: 'a', new_string: 'b' }, status: 'completed' },
    ]);
    const tools = resolveAppDevTurnTools({
      sessionKey: 'test-session',
      turnKey: 'turn-user-cache-hit',
      turnMessages: [],
      toolResults: [],
      engineType: 'openclaw',
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'Edit', status: 'completed' });
  });

  it('缓存未命中时从 transcript 的 tool_use 补全', () => {
    const tools = resolveAppDevTurnTools({
      sessionKey: 'test-session',
      turnKey: 'turn-user-no-cache',
      turnMessages: [{
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu-1', name: 'Write', input: { file_path: '/b.ts', content: 'x' } }],
      } as never],
      toolResults: [],
      engineType: 'openclaw',
    });
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'Write', status: 'completed' });
  });
});
