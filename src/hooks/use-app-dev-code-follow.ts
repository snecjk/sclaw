/**
 * 建站工作台：Agent 正在改的文件自动打开到右侧代码页。
 * 用户切换代码/页签后暂停，空闲后再跟。
 */
import { useEffect, useRef, useState } from 'react';
import { useChatRuntimeV2Store } from '@/stores/chat/runtime-v2-store';
import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';
import { revealAppDevSourceFile } from '@/lib/app-dev-reveal-source';
import {
  followAppDevLiveTools,
  isAppDevCodeFollowPaused,
} from '@/lib/app-dev-code-follow';
import type { ToolStatus } from '@/stores/chat';

const EMPTY_TOOLS: ToolStatus[] = [];

export function useAppDevCodeFollow(sessionKey: string | null) {
  const streamingTools = useChatRuntimeV2Store((state) => (
    sessionKey
      ? state.sessionsByKey[sessionKey]?.overlay.streamingTools ?? EMPTY_TOOLS
      : EMPTY_TOOLS
  ));
  const pausedUntil = useAppDevWorkbenchStore((state) => state.codeFollowPausedUntil);
  const inspectActive = useAppDevWorkbenchStore((state) => state.inspectActive);
  const tuneMode = useAppDevWorkbenchStore((state) => state.tuneMode);
  const lastKeyRef = useRef<string | null>(null);
  const [resumeAt, setResumeAt] = useState(0);

  useEffect(() => {
    lastKeyRef.current = null;
  }, [sessionKey]);

  useEffect(() => {
    if (!isAppDevCodeFollowPaused(pausedUntil)) return;
    const remaining = Math.max(0, pausedUntil - Date.now());
    const timer = window.setTimeout(() => setResumeAt(Date.now()), remaining);
    return () => window.clearTimeout(timer);
  }, [pausedUntil]);

  useEffect(() => {
    if (!sessionKey) return;
    if (inspectActive || tuneMode === 'tune') return;
    const next = followAppDevLiveTools(streamingTools, {
      pausedUntil,
      lastKey: lastKeyRef.current,
    });
    lastKeyRef.current = next.nextKey;
    if (next.revealPath) revealAppDevSourceFile(next.revealPath);
  }, [sessionKey, streamingTools, pausedUntil, resumeAt, inspectActive, tuneMode]);
}

/** 独立挂载，避免 streamingTools 更新重绘整个建站工作台。 */
export function AppDevCodeFollow({ sessionKey }: { sessionKey: string | null }) {
  useAppDevCodeFollow(sessionKey);
  return null;
}
