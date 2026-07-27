import { describe, expect, it } from 'vitest';
import {
  resolveProcessStatusLabelKey,
  resolveTurnProcessStatus,
  shouldShowProcessStatusLoading,
} from '@/pages/Chat/thinking/turn-process-status';

describe('TurnProcessStatus', () => {
  it('shows thinking when process segments stream without running tool', () => {
    const status = resolveTurnProcessStatus({
      isLiveStream: true,
      isConnecting: false,
      isProcessing: false,
      isStillExecuting: false,
      streamingTools: [],
      hasProcessSegments: true,
      hasFinalReplyStreaming: false,
    });
    expect(status).toBe('thinking');
    expect(resolveProcessStatusLabelKey(status)).toBe('streaming.thinkingNow');
  });

  it('tool_running beats organizing_tool_results (no dual loading)', () => {
    const status = resolveTurnProcessStatus({
      isLiveStream: true,
      isConnecting: false,
      isProcessing: true,
      isStillExecuting: false,
      streamingTools: [{ status: 'running', input: { path: '/tmp' } }],
      hasProcessSegments: true,
      hasFinalReplyStreaming: false,
    });
    expect(status).toBe('tool_running');
    expect(resolveProcessStatusLabelKey(status)).toBe('streaming.runningTool');
  });

  it('shows tool_input_streaming when running tool has unknown input', () => {
    const status = resolveTurnProcessStatus({
      isLiveStream: true,
      isConnecting: false,
      isProcessing: false,
      isStillExecuting: false,
      streamingTools: [{ status: 'running', input: undefined }],
      hasProcessSegments: true,
      hasFinalReplyStreaming: false,
    });
    expect(status).toBe('tool_input_streaming');
  });

  it('shows finalizing when reply bubble streams', () => {
    const status = resolveTurnProcessStatus({
      isLiveStream: true,
      isConnecting: false,
      isProcessing: false,
      isStillExecuting: false,
      streamingTools: [],
      hasProcessSegments: true,
      hasFinalReplyStreaming: true,
    });
    expect(status).toBe('finalizing');
  });

  it('hides organizing_tool_results when final reply is already visible', () => {
    const status = resolveTurnProcessStatus({
      isLiveStream: true,
      isConnecting: false,
      isProcessing: true,
      isStillExecuting: false,
      streamingTools: [],
      hasProcessSegments: true,
      hasFinalReplyStreaming: false,
      hasVisibleFinalReply: true,
    });
    expect(status).toBe('idle');
    expect(shouldShowProcessStatusLoading(status)).toBe(false);
  });

  it('fallback still_executing prevents loading gap', () => {
    const status = resolveTurnProcessStatus({
      isLiveStream: true,
      isConnecting: false,
      isProcessing: false,
      isStillExecuting: false,
      streamingTools: [],
      hasProcessSegments: false,
      hasFinalReplyStreaming: false,
    });
    expect(status).toBe('still_executing');
    expect(shouldShowProcessStatusLoading(status)).toBe(true);
  });
});
