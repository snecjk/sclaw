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

/** 主区页签：预览 / 代码 / 版本 + 溢出菜单内的 more-* 面板。 */
export type AppDevStageMode =
  | 'preview'
  | 'code'
  | 'versions'
  | 'more-git'
  | 'more-external'
  | 'more-community'
  | 'more-assets';

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
  /** 右列 对话 ↔ 手动微调面板 切换（T06 使用）。 */
  tuneMode: AppDevTuneMode;
  /** 「查看修改」diff 请求（T04/T10），消费方处理后自行清空。 */
  diffRequest: AppDevHashRequest | null;
  /** 「恢复版本」请求（T04 使用），消费方处理后自行清空。 */
  versionRestoreRequest: AppDevHashRequest | null;
  /** T14：从「文件」页跳转到代码页并打开路径（消费后清空）。 */
  assetRevealPath: string | null;
  setMode: (mode: AppDevStageMode) => void;
  setStageCollapsed: (collapsed: boolean) => void;
  toggleStageCollapsed: () => void;
  setDevice: (device: AppDevPreviewDevice) => void;
  setTuneMode: (tuneMode: AppDevTuneMode) => void;
  setDiffRequest: (request: AppDevHashRequest | null) => void;
  setVersionRestoreRequest: (request: AppDevHashRequest | null) => void;
  setAssetRevealPath: (path: string | null) => void;
}

export const useAppDevWorkbenchStore = create<AppDevWorkbenchState>()(
  persist(
    (set) => ({
      mode: 'preview',
      stageCollapsed: false,
      device: 'desktop',
      tuneMode: 'chat',
      diffRequest: null,
      versionRestoreRequest: null,
      assetRevealPath: null,

      setMode: (mode) => {
        if (!isAppDevStageMode(mode)) return;
        set({ mode });
      },
      setStageCollapsed: (collapsed) => set({ stageCollapsed: collapsed }),
      toggleStageCollapsed: () => set((s) => ({ stageCollapsed: !s.stageCollapsed })),
      setDevice: (device) => set({ device }),
      setTuneMode: (tuneMode) => set({ tuneMode }),
      setDiffRequest: (request) => set({ diffRequest: request }),
      setVersionRestoreRequest: (request) => set({ versionRestoreRequest: request }),
      setAssetRevealPath: (path) => set({ assetRevealPath: path }),
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
