import { describe, expect, it } from 'vitest';

import {
  buildTrialRunTimeline,
  collectTrialRunArtifacts,
  resolveTrialRunLaunchConfirmation,
  resolveTrialRunView,
  shouldShowStartupRunDialog,
} from '@/pages/WorkflowDesigner/components/test-run-drawer-model';
import type { WorkflowRunResponse } from '@/types/workflow';

function runFixture(overrides: Partial<WorkflowRunResponse> = {}): WorkflowRunResponse {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    workflowVersion: 7,
    status: 'running',
    startedAt: '2026-08-12T10:11:35+08:00',
    nodeRuns: [],
    events: [],
    artifacts: [],
    output: null,
    ...overrides,
  };
}

describe('test run drawer model', () => {
  it.each([
    [{ isStarting: true, status: null, launchError: null }, 'running'],
    [{ isStarting: true, status: 'cancelled', launchError: null }, 'running'],
    [{ isStarting: false, isRunActive: true, status: 'cancelled', launchError: null }, 'running'],
    [{ isStarting: false, status: 'cancelled', launchError: null }, 'cancelled'],
    [{ isStarting: false, status: 'timeout', launchError: null }, 'failed'],
    [{ isStarting: false, status: 'completed', launchError: null }, 'completed'],
  ] as const)('resolves the trial view from runtime facts', (input, expected) => {
    expect(resolveTrialRunView(input)).toBe(expected);
  });

  it('never renders engine confirmation behind an open run drawer', () => {
    expect(shouldShowStartupRunDialog({
      isStartupDialogOpen: true,
      isDrawerOpen: true,
    })).toBe(false);
    expect(shouldShowStartupRunDialog({
      isStartupDialogOpen: true,
      isDrawerOpen: false,
    })).toBe(true);
  });

  it('reuses the first confirmed engine and startup inputs for rerun', () => {
    const cached = {
      inputs: { city: '兰州', days: 7 },
      engineType: 'openclaw' as const,
    };
    expect(resolveTrialRunLaunchConfirmation(runFixture({
      engineType: 'claude',
      input: { inputs: { city: '上海' } } as WorkflowRunResponse['input'],
    }), cached)).toBe(cached);
  });

  it('restores persisted engine and startup inputs when rerunning a history record', () => {
    expect(resolveTrialRunLaunchConfirmation(runFixture({
      engineType: 'openclaw',
      input: { inputs: { city: '兰州', days: 7 } } as WorkflowRunResponse['input'],
    }), null)).toEqual({
      inputs: { city: '兰州', days: 7 },
      engineType: 'openclaw',
    });
  });

  it('coalesces actual agent answer deltas using the latest cumulative raw text', () => {
    const timeline = buildTrialRunTimeline(runFixture({
      events: [
        {
          id: '1',
          type: 'agent.answer_delta',
          nodeId: 'node-1',
          payload: { message: '工', rawText: '工' },
          timestamp: '2026-08-12T10:11:35.100+08:00',
        },
        {
          id: '2',
          type: 'agent.answer_delta',
          nodeId: 'node-1',
          payload: { message: '工资', rawText: '工资' },
          timestamp: '2026-08-12T10:11:35.200+08:00',
        },
      ],
      lastAgentRawText: '工资',
    }), null);

    expect(timeline).toEqual([
      expect.objectContaining({
        id: '1',
        label: '实时输出',
        detail: '工资',
        timestamp: '2026-08-12T10:11:35.200+08:00',
      }),
    ]);
  });

  it('keeps tools and different nodes as answer-delta boundaries', () => {
    const timeline = buildTrialRunTimeline(runFixture({
      events: [
        {
          id: '1',
          type: 'agent.answer_delta',
          nodeId: 'node-1',
          payload: { message: '查询中', rawText: '查询中' },
          timestamp: '2026-08-12T10:11:35.100+08:00',
        },
        {
          id: '2',
          type: 'agent.tool_start',
          nodeId: 'node-1',
          payload: { toolName: 'salary.query' },
          timestamp: '2026-08-12T10:11:35.200+08:00',
        },
        {
          id: '3',
          type: 'agent.answer_delta',
          nodeId: 'node-1',
          payload: { message: '查询完成', rawText: '查询中查询完成' },
          timestamp: '2026-08-12T10:11:35.300+08:00',
        },
        {
          id: '4',
          type: 'agent.answer_delta',
          nodeId: 'node-2',
          payload: { message: '下一节点', rawText: '下一节点' },
          timestamp: '2026-08-12T10:11:35.400+08:00',
        },
      ],
    }), null);

    expect(timeline.map(({ label, detail }) => ({ label, detail }))).toEqual([
      { label: '实时输出', detail: '查询中' },
      { label: '请求工具', detail: 'salary.query' },
      { label: '实时输出', detail: '查询完成' },
      { label: '实时输出', detail: '下一节点' },
    ]);
  });

  it('continues to coalesce legacy output deltas without cumulative raw text', () => {
    const timeline = buildTrialRunTimeline(runFixture({
      events: [
        { id: '1', type: 'agent.output.delta', payload: '第一段', timestamp: '2026-08-12T10:11:35+08:00' },
        { id: '2', type: 'agent.output.delta', payload: '第二段', timestamp: '2026-08-12T10:11:36+08:00' },
      ],
    }), null);

    expect(timeline).toEqual([
      expect.objectContaining({ label: '实时输出', detail: '第一段第二段' }),
    ]);
  });

  it('resets the cumulative raw-text baseline when an agent attempt restarts', () => {
    const timeline = buildTrialRunTimeline(runFixture({
      events: [
        {
          id: '1',
          type: 'agent.answer_delta',
          nodeId: 'node-1',
          payload: { message: '报', rawText: '报' },
          timestamp: '2026-08-12T10:11:35.100+08:00',
        },
        {
          id: '2',
          type: 'agent.attempt.start',
          nodeId: 'node-1',
          payload: { attempt: 2 },
          timestamp: '2026-08-12T10:11:35.200+08:00',
        },
        {
          id: '3',
          type: 'agent.answer_delta',
          nodeId: 'node-1',
          payload: { message: '报表', rawText: '报表' },
          timestamp: '2026-08-12T10:11:35.300+08:00',
        },
      ],
    }), null);

    expect(timeline
      .filter((item) => item.label === '实时输出')
      .map((item) => item.detail)).toEqual(['报', '报表']);
  });

  it('deduplicates the same artifact across run and result payloads', () => {
    const artifacts = collectTrialRunArtifacts(runFixture({
      artifacts: [{ id: 'artifact-1', name: '对账表.xlsx', type: 'file', url: '/tmp/report.xlsx' }],
      result: {
        artifacts: [{ id: 'artifact-1', name: '对账表.xlsx', type: 'file', filePath: '/tmp/report.xlsx' }],
      },
    }), null);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ id: 'artifact-1', name: '对账表.xlsx' });
  });
});
