/**
 * ContentHeader 垂直几何权威常量（Stage 3 统一顶栏垂直契约）。
 *
 * 运行时已确认：Workspace frame 8 + Header 52 → centerY 34。
 * MCP 三栏 Frame `48:10928` Header 子 Node 高度均为 52（见 OpenSpec design §9）。
 * 禁止页面局部用 translate-y / 负 margin 伪造对齐。
 */

/** 一级 ContentHeader 高度（唯一权威；同步 `--sto-content-header-h`） */
export const CONTENT_HEADER_HEIGHT_PX = 52;

/** Workspace 顶 Frame（`--sto-shell-card-gap`）；Header top = 该值 */
export const WORKSPACE_FRAME_TOP_PX = 8;

/** 窗口坐标系下 Header 中心线：frame + height/2 */
export const CONTENT_HEADER_CENTER_Y_PX =
  WORKSPACE_FRAME_TOP_PX + CONTENT_HEADER_HEIGHT_PX / 2; // 34

/** Header bottom → Body Surface */
export const WORKBENCH_HEADER_TO_BODY_GAP_PX = 8;

/** Body Surface → 第一行正文（Conversation scroll padding-top） */
export const WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX = 8;

/** Header bottom → 第一行正文的总视觉距离 */
export const WORKBENCH_HEADER_TO_CONTENT_TOTAL_PX =
  WORKBENCH_HEADER_TO_BODY_GAP_PX + WORKBENCH_BODY_TO_CONTENT_INSET_Y_PX; // 16

/** macOS traffic light 直径（points）；Electron y = 按钮顶边 */
export const MACOS_TRAFFIC_LIGHT_DIAMETER_PX = 12;

/**
 * 现网失败值 `{ x:16, y:18 }`：圆心 ≈ 24，相对 Header centerY 34 偏差 10px。
 * 校准：y = centerY − diameter/2 = 28 → 圆心 34。
 */
export const MACOS_TRAFFIC_LIGHT_POSITION_BEFORE_CALIBRATION = {
  x: 16,
  y: 18,
} as const;

export const MACOS_TRAFFIC_LIGHT_POSITION = {
  x: 16,
  y: CONTENT_HEADER_CENTER_Y_PX - MACOS_TRAFFIC_LIGHT_DIAMETER_PX / 2, // 28
} as const;

export function trafficLightCenterY(positionY: number, diameter = MACOS_TRAFFIC_LIGHT_DIAMETER_PX): number {
  return positionY + diameter / 2;
}
