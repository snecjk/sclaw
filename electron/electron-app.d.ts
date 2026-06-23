/**
 * Electron Linux API 类型补充。
 *
 * `app.setDesktopName` 在运行时存在，但 Electron 40.x 官方 `electron.d.ts` 尚未声明
 * （上游文档见 https://github.com/electron/electron/pull/51426）。
 */
declare namespace Electron {
  interface App {
    /**
     * Linux：设置 `.desktop` 文件名（如 `stoclaw.desktop`），需在 `ready` 前调用。
     * 用于 Wayland 图标/分组与 X11 `WM_CLASS` 匹配。
     *
     * @platform linux
     */
    setDesktopName(name: string): void;
  }
}