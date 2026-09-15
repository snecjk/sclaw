/**
 * 建站回合结束后：综合自检 +（失败时）仅向建站会话自动发起修复。
 * 不碰主会话。healPending 为 true 时若再次失败则停止自动修，避免死循环。
 */
import { toast } from 'sonner';
import { drainAppErrors, runAppDevVerify } from '@/lib/app-dev-api';
import { useChatStore } from '@/stores/chat';

export interface AppDevPostTurnVerifyInput {
  workspaceId: string;
  appDevSessionKey: string | null;
  /** 当前 UI 已收集的预览 runtime 错误 */
  pendingPreviewErrors?: string[];
  healPendingRef: { current: boolean };
  onPreviewErrors?: (errors: string[]) => void;
}

export async function runAppDevPostTurnVerify(input: AppDevPostTurnVerifyInput): Promise<void> {
  const {
    workspaceId,
    appDevSessionKey,
    pendingPreviewErrors = [],
    healPendingRef,
    onPreviewErrors,
  } = input;

  const drained = await drainAppErrors(workspaceId).catch(() => [] as string[]);
  const previewErrors = Array.from(new Set([
    ...pendingPreviewErrors.map((line) => line.trim()).filter(Boolean),
    ...drained.map((line) => line.trim()).filter(Boolean),
  ])).slice(-20);

  if (previewErrors.length > 0) {
    onPreviewErrors?.(previewErrors);
  }

  toast.message('正在复检…');
  const verify = await runAppDevVerify(workspaceId, { previewErrors }).catch((err: unknown) => ({
    ok: false as const,
    steps: [] as Array<{ name: string; ok: boolean; output?: string }>,
    prompt: err instanceof Error
      ? `建站复检调用失败：${err.message}`
      : '建站复检调用失败，请检查本地环境后继续修复。',
  }));

  if (verify.ok) {
    onPreviewErrors?.([]);
    if (healPendingRef.current) {
      healPendingRef.current = false;
      toast.success('已修好，可以继续用');
    }
    return;
  }

  const prompt = verify.prompt?.trim();
  if (!prompt) {
    toast.error('复检未通过，但没有可用的修复说明');
    return;
  }

  if (healPendingRef.current) {
    healPendingRef.current = false;
    toast.error('已自动修复一轮仍未通过，请查看复检结果或手动说明问题');
    return;
  }

  if (!appDevSessionKey) {
    toast.error('复检未通过，但建站会话未就绪，无法自动修复');
    return;
  }

  healPendingRef.current = true;
  toast.message('复检未通过，继续自动修复…');
  try {
    await useChatStore.getState().sendMessage({
      text: prompt,
      sessionKey: appDevSessionKey,
    });
  } catch {
    healPendingRef.current = false;
    toast.error('自动修复发送失败，请手动把复检结果交给 AI');
  }
}
