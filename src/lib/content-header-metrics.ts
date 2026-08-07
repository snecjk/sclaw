/**
 * ContentHeader 垂直几何权威常量（Stage 3 统一顶栏垂直契约）。
 *
 * 最新产品验收：Workspace frame 8 + Header 44 → centerY 30。
 * MCP 三栏 Frame `48:10928` 的 52px 仅保留为历史测量（见 OpenSpec design §9.6）。
 * 禁止页面局部用 translate-y / 负 margin 伪造对齐。
 */

/** 一级 ContentHeader 高度（唯一权威；同步 `--sto-content-header-h`） */
export const CONTENT_HEADER_HEIGHT_PX = 44;

/** Header 主要交互框 / Session / Artifact / Search 的共享高度。 */
export const CONTENT_HEADER_CONTROL_HEIGHT_PX = 28;

/** Workspace 顶 Frame（`--sto-shell-card-gap`）；Header top = 该值 */
export const WORKSPACE_FRAME_TOP_PX = 8;

/** 窗口坐标系下 Header 中心线：frame + height/2 */
export const CONTENT_HEADER_CENTER_Y_PX =
  WORKSPACE_FRAME_TOP_PX + CONTENT_HEADER_HEIGHT_PX / 2; // 30

/** Conversation：Header bottom → Body Surface */
export const CONVERSATION_HEADER_TO_SURFACE_GAP_PX = 0;

/** Split：Header bottom → Chat / Preview Surface（用户确认 2026-08-02） */
export const SPLIT_HEADER_TO_SURFACE_GAP_PX = 0;

/** Preview Expanded：Header bottom → bordered Preview Surface（用户确认 2026-08-02） */
export const PREVIEW_EXPANDED_HEADER_TO_SURFACE_GAP_PX = 0;

/** Body Surface → 第一行正文（Conversation scroll padding-top） */
export const WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX = 8;

/** Split / Preview Expanded Surface → Workspace Body 底边 */
export const WORKBENCH_SURFACE_BOTTOM_INSET_PX = 8;

/** Conversation Header bottom → 第一行正文的总视觉距离 */
export const CONVERSATION_HEADER_TO_CONTENT_TOTAL_PX =
  CONVERSATION_HEADER_TO_SURFACE_GAP_PX + WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX; // 8

/** Split Header bottom → 第一行正文的总视觉距离 */
export const SPLIT_HEADER_TO_CONTENT_TOTAL_PX =
  SPLIT_HEADER_TO_SURFACE_GAP_PX + WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX; // 8

/** macOS traffic light 直径（points）；Electron y = 按钮顶边 */
export const MACOS_TRAFFIC_LIGHT_DIAMETER_PX = 12;

/**
 * 上一版把系统红绿灯强行对齐 ContentHeader 中心线，得到 y=28。
 * 最新设计按窗口原生 chrome 的光学基线固定为 y=20；它与 Sidebar 控件、
 * ContentHeader 内容是三套独立基线，禁止再次用 Header centerY 反推。
 */
export const MACOS_TRAFFIC_LIGHT_POSITION_BEFORE_CALIBRATION = {
  x: 16,
  y: 28,
} as const;

export const MACOS_TRAFFIC_LIGHT_POSITION = {
  x: 16,
  y: 20,
} as const;

/** macOS 省区 Sidebar 收起钮顶边与点击框；独立于系统红绿灯。 */
export const MACOS_SIDEBAR_TOGGLE_TOP_PX = 16;
export const SIDEBAR_CHROME_TOGGLE_SIZE_PX = 28;

export function trafficLightCenterY(positionY: number, diameter = MACOS_TRAFFIC_LIGHT_DIAMETER_PX): number {
  return positionY + diameter / 2;
}
