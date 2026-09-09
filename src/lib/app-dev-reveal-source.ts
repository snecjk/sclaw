import { useAppDevWorkbenchStore } from '@/stores/app-dev-workbench';

const SOURCE_ROOT_MARKERS = ['/frontend/', '/src/', '/public/', '/backend/'] as const;
const SANDBOX_ROOTS = new Set(['app', 'tmp']);

/** 把工具 input 里的绝对/杂乱路径收成工作区相对路径，供代码页打开。 */
export function toAppDevSourceRelativePath(path: string): string {
  let next = path.replace(/\\/g, '/').trim();
  if (!next) return next;
  next = next.replace(/^\.\//, '');
  const isWinAbs = /^[A-Za-z]:\//.test(next);
  if (isWinAbs) next = next.slice(2);
  const isAbsolute = isWinAbs || next.startsWith('/');
  if (!isAbsolute) return next;

  const lowered = next.toLowerCase();
  for (const marker of SOURCE_ROOT_MARKERS) {
    const index = lowered.indexOf(marker);
    if (index >= 0) return next.slice(index + 1);
  }
  const stripped = next.replace(/^\/+/, '');
  const slash = stripped.indexOf('/');
  if (slash > 0 && SANDBOX_ROOTS.has(stripped.slice(0, slash))) {
    return stripped.slice(slash + 1);
  }
  return stripped;
}

/** 对话里点文件名：展开工作区、切到代码页并打开该路径。 */
export function revealAppDevSourceFile(path: string): void {
  const relative = toAppDevSourceRelativePath(path);
  if (!relative) return;
  const workbench = useAppDevWorkbenchStore.getState();
  if (workbench.stageCollapsed) workbench.setStageCollapsed(false);
  workbench.setMode('code');
  workbench.setAssetRevealPath(relative);
}
