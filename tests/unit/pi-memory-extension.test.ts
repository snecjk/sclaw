import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  configurePiMemoryRuntime,
  loadPiMemoryExtension,
  PI_MEMORY_TOOL_NAMES,
} from '../../electron/agent-extensions/extensions/pi-memory/pi';

describe('Pi memory runtime configuration', () => {
  it('uses SClaw managed storage and phase-one defaults', () => {
    const env: NodeJS.ProcessEnv = { PI_AGENT_HOME: 'D:\\SClaw\\pi' };

    configurePiMemoryRuntime(env);

    expect(env.PI_MEMORY_DIR).toBe(join('D:\\SClaw\\pi', 'memory'));
    expect(env.PI_MEMORY_SNAPSHOT).toBe('stable');
    expect(env.PI_MEMORY_QMD_UPDATE).toBe('off');
    expect(env.PI_MEMORY_EXIT_SUMMARY).toBe('0');
  });

  it('preserves explicit memory configuration', () => {
    const env: NodeJS.ProcessEnv = {
      PI_AGENT_HOME: 'D:\\SClaw\\pi',
      PI_MEMORY_DIR: 'E:\\personal-memory',
      PI_MEMORY_SNAPSHOT: 'per-turn',
      PI_MEMORY_QMD_UPDATE: 'manual',
      PI_MEMORY_EXIT_SUMMARY: '1',
    };

    configurePiMemoryRuntime(env);

    expect(env).toMatchObject({
      PI_MEMORY_DIR: 'E:\\personal-memory',
      PI_MEMORY_SNAPSHOT: 'per-turn',
      PI_MEMORY_QMD_UPDATE: 'manual',
      PI_MEMORY_EXIT_SUMMARY: '1',
    });
  });

  it('declares every native memory tool for collision checks', () => {
    expect(PI_MEMORY_TOOL_NAMES).toEqual([
      'memory_write',
      'memory_forget',
      'memory_restore',
      'memory_read',
      'scratchpad',
      'memory_search',
      'memory_status',
    ]);
  });

  it('loads the TypeScript-only package and registers its tools', async () => {
    const extension = await loadPiMemoryExtension(
      async () => import('pi-memory'),
      'D:\\SClaw\\dist-electron\\pi-runtime',
    );
    const registeredTools: string[] = [];
    const registeredEvents: string[] = [];

    await extension.factory({
      registerTool(tool) {
        registeredTools.push(tool.name);
      },
      on(event) {
        registeredEvents.push(event);
      },
    } as never);

    expect(registeredTools).toEqual(expect.arrayContaining([...PI_MEMORY_TOOL_NAMES]));
    expect(registeredEvents).toEqual(expect.arrayContaining([
      'session_start',
      'before_agent_start',
      'session_before_compact',
      'session_shutdown',
    ]));
  });
});
