/**
 * AppDevWorkbenchStore — 建站工作台 UI 状态（页签 mode / 工作区折叠 / 预览设备等）。
 *
 * mode 从 AppDevWorkbenchStage 组件内 useState 提升到本 store：
 * 对话侧（汇总卡操作行、产物卡等）可以通过 setMode 驱动工作台切换。
 * `mode` 与 `stageCollapsed` persist 到 localStorage，重启保留；
 * 其余字段为瞬态请求/状态，不落盘。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { APP_DEV_CODE_FOLLOW_IDLE_MS } from '@/lib/app-dev-code-follow-idle';

/** 主区页签：预览 / 代码 / 版本 + 溢出菜单内的 more-* 面板。 */
export type AppDevStageMode =
  | 'preview'
  | 'code'
  | 'versions'
  | 'more-git'
  | 'more-external'
  | 'more-community'
  | 'more-assets'
  | 'more-runtime';

export type AppDevPreviewDevice = 'desktop' | 'mobile';
export type AppDevTuneMode = 'chat' | 'tune';

export interface AppDevHashRequest {
  hash: string;
  /** T10：任意两版对比时的 base（省略则相对父 commit）。 */
  baseHash?: string;
}

const APP_DEV_STAGE_MODES: readonly AppDevStageMode[] = [
  'preview',
  'code',
  'versions',
  'more-git',
  'more-external',
  'more-community',
  'more-assets',
  'more-runtime',
];

export function isAppDevStageMode(value: unknown): value is AppDevStageMode {
  return typeof value === 'string'
    && (APP_DEV_STAGE_MODES as readonly string[]).includes(value);
}

interface AppDevWorkbenchState {
  mode: AppDevStageMode;
  /** 收起工作区：只保留对话列（全宽），工作台保活隐藏。 */
  stageCollapsed: boolean;
  /** 预览设备（T03 使用），默认桌面。 */
  device: AppDevPreviewDevice;
  /** 右列 对话 ↔ 手动微调面板 切换（T06 使用）。与 inspectActive 独立。 */
  tuneMode: AppDevTuneMode;
  /** 预览圈选「对话修改」：不依赖手动微调面板。 */
  inspectActive: boolean;
  /** 「查看修改」diff 请求（T04/T10），消费方处理后自行清空。 */
  diffRequest: AppDevHashRequest | null;
  /** 「恢复版本」请求（T04 使用），消费方处理后自行清空。 */
  versionRestoreRequest: AppDevHashRequest | null;
  /** T14：从「文件」页跳转到代码页并打开路径（消费后清空）。 */
  assetRevealPath: string | null;
  /**
   * Agent 跟随时用户操作代码页的暂停截止时间。
   * 0 表示正在跟随；用户切页/切文件后设为 now + idle。
   */
  codeFollowPausedUntil: number;
  setMode: (mode: AppDevStageMode) => void;
  setStageCollapsed: (collapsed: boolean) => void;
  toggleStageCollapsed: () => void;
  setDevice: (device: AppDevPreviewDevice) => void;
  setTuneMode: (tuneMode: AppDevTuneMode) => void;
  setInspectActive: (inspectActive: boolean) => void;
  setDiffRequest: (request: AppDevHashRequest | null) => void;
  setVersionRestoreRequest: (request: AppDevHashRequest | null) => void;
  setAssetRevealPath: (path: string | null) => void;
  pauseCodeFollow: (idleMs?: number) => void;
}

export const useAppDevWorkbenchStore = create<AppDevWorkbenchState>()(
  persist(
    (set) => ({
      mode: 'preview',
      stageCollapsed: false,
      device: 'desktop',
      tuneMode: 'chat',
      inspectActive: false,
      diffRequest: null,
      versionRestoreRequest: null,
      assetRevealPath: null,
      codeFollowPausedUntil: 0,

      setMode: (mode) => {
        if (!isAppDevStageMode(mode)) return;
        set({ mode });
      },
      setStageCollapsed: (collapsed) => set({ stageCollapsed: collapsed }),
      toggleStageCollapsed: () => set((s) => ({ stageCollapsed: !s.stageCollapsed })),
      setDevice: (device) => set({ device }),
      setTuneMode: (tuneMode) => set((state) => ({
        tuneMode,
        inspectActive: tuneMode === 'tune' ? false : state.inspectActive,
      })),
      setInspectActive: (inspectActive) => set((state) => ({
        inspectActive,
        tuneMode: inspectActive ? 'chat' : state.tuneMode,
      })),
      setDiffRequest: (request) => set({ diffRequest: request }),
      setVersionRestoreRequest: (request) => set({ versionRestoreRequest: request }),
      setAssetRevealPath: (path) => set({ assetRevealPath: path }),
      pauseCodeFollow: (idleMs = APP_DEV_CODE_FOLLOW_IDLE_MS) => {
        const duration = Number.isFinite(idleMs) && idleMs > 0
          ? idleMs
          : APP_DEV_CODE_FOLLOW_IDLE_MS;
        set({ codeFollowPausedUntil: Date.now() + duration });
      },
    }),
    {
      name: 'stoclaw:app-dev-workbench-v1',
      version: 1,
      partialize: (state) => ({
        mode: state.mode,
        stageCollapsed: state.stageCollapsed,
      }),
      // 兜底非法持久化值（旧版本/手改 localStorage），保证 mode 始终合法。
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppDevWorkbenchState>;
        return {
          ...current,
          mode: isAppDevStageMode(p.mode) ? p.mode : current.mode,
          stageCollapsed: typeof p.stageCollapsed === 'boolean'
            ? p.stageCollapsed
            : current.stageCollapsed,
        };
      },
    },
  ),
);
