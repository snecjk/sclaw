/**
 * Public JSBridge method contracts for Guest SDK / H5 documentation.
 * All methods use stoClaw.call('<method>', params).
 */

/** 1. 获取当前 SSO 用户信息（不含 token） */
export interface UserGetInfoResult {
  userId: string;
  userName: string;
  realName: string;
  empCode: string;
  companyCode: string;
  companyName: string;
  departmentCode: string;
  departmentName: string;
  categoryCode: string;
  isAdministrator: boolean;
}

/** 2. 统一 UI — 提示框 */
export interface UiAlertParams {
  title?: string;
  message: string;
  confirmLabel?: string;
}

/** 2. 统一 UI — 确认框 */
export interface UiConfirmParams {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/** 2. 统一 UI — 打开抽屉（当前支持 chat = 应用广场右侧 AI 面板） */
export interface UiOpenDrawerParams {
  kind?: 'chat';
}

/** 3. 统一跳转 */
export interface NavJumpParams {
  /** webview=打开应用广场 tab；app=按 appId 打开 catalog/我的应用；route=Claw 内路由；external=系统浏览器 */
  type: 'webview' | 'app' | 'route' | 'external';
  url?: string;
  appId?: string;
  route?: string;
  title?: string;
}

/** 4. 回填会话输入框 */
export interface ChatFillComposerParams {
  text: string;
  /**
   * embed = 应用广场 webview 右侧会话；
   * main = 首页/主会话左侧对话框；
   * auto = 来自 embed webview 时填右侧，否则填主会话。
   */
  target?: 'embed' | 'main' | 'auto';
  /** true 时回填后立即发送 */
  send?: boolean;
  /** embed 目标时是否先打开右侧 AI 面板 */
  openPanel?: boolean;
}

/** 5. 打开新会话并可选预填/发送 */
export interface ChatOpenSessionParams {
  target?: 'embed' | 'main';
  text?: string;
  send?: boolean;
  /** 新会话标题（main 会话标签 / embed 子会话） */
  title?: string;
}

export interface ChatSendMessageParams {
  text: string;
  target?: 'embed' | 'main' | 'auto';
  openPanel?: boolean;
}
