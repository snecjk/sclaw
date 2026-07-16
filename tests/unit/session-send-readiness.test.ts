import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  awaitSessionSendReadiness,
  clearSessionSendReadinessForTests,
  registerSessionSendReadiness,
} from '@/lib/session-send-readiness';

describe('session send readiness', () => {
  beforeEach(() => clearSessionSendReadinessForTests());

  it('waits for registered session setup', async () => {
    let release!: () => void;
    const setup = new Promise<void>((resolve) => { release = resolve; });
    registerSessionSendReadiness('agent:project:session-1', setup);

    const ready = vi.fn();
    const waiting = awaitSessionSendReadiness('agent:project:session-1').then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();

    release();
    await waiting;
    expect(ready).toHaveBeenCalledOnce();
  });

  it('propagates setup failure so send can be blocked', async () => {
    registerSessionSendReadiness('agent:project:session-2', Promise.reject(new Error('bind failed')));
    await expect(awaitSessionSendReadiness('agent:project:session-2')).rejects.toThrow('bind failed');
    await expect(awaitSessionSendReadiness('agent:project:session-2')).rejects.toThrow('bind failed');
  });

  it('waits for every setup registered for the same session', async () => {
    const completed: string[] = [];
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; })
      .then(() => { completed.push('bind'); });
    const second = Promise.resolve().then(() => { completed.push('model'); });

    registerSessionSendReadiness('agent:project:session-3', first);
    registerSessionSendReadiness('agent:project:session-3', second);
    const waiting = awaitSessionSendReadiness('agent:project:session-3');
    await Promise.resolve();
    expect(completed).toEqual(['model']);

    releaseFirst();
    await waiting;
    expect(completed).toEqual(['model', 'bind']);
  });
});
