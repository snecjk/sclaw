/** Browser Automation Platform (BAP) — shared types for Step 1. */

export type BrowserAutomationSessionSource = 'embed' | 'managed';

export type BrowserAutomationAction =
  | 'click'
  | 'fill'
  | 'select'
  | 'navigate'
  | 'scroll'
  | 'press'
  // ── 对齐 Kimi WebBridge 的扩展动作（波次 0 起类型先行，分发实现见后续波次）──
  | 'mouse_click'
  | 'read_page'
  | 'screenshot'
  | 'print_pdf'
  | 'network_capture';

export type BrowserAutomationRunStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'PAUSED'
  | 'WAITING_HUMAN';

export type BrowserAutomationStepStatus =
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED'
  | 'VALIDATING';

/**
 * 全局错误码枚举（对齐计划文档 §四 全局约定）。
 * HTTP 映射约定：UNAUTHORIZED→401、HOST_MISMATCH→403、FEATURE_DISABLED→503、
 * PAYLOAD_TOO_LARGE→413；其余为领域错误，走既有 `{ success:false, error }` 信封。
 */
export type BrowserAutomationErrorCode =
  // 引用与目标
  | 'STALE_REF'              // 代际不匹配，必须重新 observe
  | 'ELEMENT_NOT_FOUND'
  | 'ELEMENT_NOT_VISIBLE'
  | 'PAGE_NOT_VISIBLE'       // 可见性守卫
  // 输入投递
  | 'CLICK_OCCLUDED'         // 被遮挡且降级失败
  | 'CLICK_NOT_DELIVERED'    // 投递探针未命中
  | 'FILL_NOT_STUCK'         // 填后校验失败
  // 对话框
  | 'DIALOG_STORM'           // dialog 熔断
  // CDP
  | 'CDP_TIMEOUT'
  | 'CDP_DOMAIN_UNSUPPORTED' // 触发 DOM 观察回退
  | 'CDP_METHOD_NOT_ALLOWED' // P2 白名单拒绝
  // HTTP 层
  | 'UNAUTHORIZED'           // 401 token 缺失/错误
  | 'HOST_MISMATCH'          // 403 Host 头非白名单
  | 'FEATURE_DISABLED'       // 503 总开关/flag 关闭
  | 'PAYLOAD_TOO_LARGE'      // 413
  // 会话与产物
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXPIRED'
  | 'ARTIFACT_WRITE_FAILED'
  // Bridge
  | 'BRIDGE_SESSION_NOT_FOUND'
  | 'BRIDGE_VERSION_MISMATCH';

export interface BrowserAutomationBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserAutomationElementRef {
  /** Compact ref for LLM, e.g. @e3 — valid for current observation only. */
  ref: string;
  /** Stable across observations within a session (selector hash / AX backendNodeId). */
  stableKey: string;
  role: string;
  name: string;
  tag: string;
  selector: string;
  clickable: boolean;
  editable: boolean;
  value?: string;
  states: string[];
  /**
   * DOM 模式必有；AX 模式下 DOM.getContentQuads 补齐失败的节点可缺省（B6，§六 R1 降级路径）。
   */
  boundingBox?: BrowserAutomationBoundingBox;
  /** AX 模式：CDP backendNodeId（ref ↔ backendNodeId 映射由主进程 RefTable 持有，B6）。 */
  backendNodeId?: number;
  /** AX 模式：父链上最近一个持 ref 的祖先（find 的 interactiveAncestorRef 上溯依据）。 */
  parentRef?: string;
  /** AX 模式：预算降级时被折叠的子树标记，可凭本节点 ref 下钻（expandRef）。 */
  hasCollapsedSubtree?: boolean;
}

/** 一次 JS dialog 的记录（alert/confirm/prompt/beforeunload），由 dialog-guard 产出。 */
export interface BrowserAutomationDialogRecord {
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
  message: string;
  defaultValue?: string;
  handled: 'accepted' | 'dismissed' | 'auto';
  at: number;
}

export interface BrowserAutomationPageObservation {
  sessionId: string;
  url: string;
  title: string;
  timestamp: number;
  elements: BrowserAutomationElementRef[];
  fingerprint: string;
  networkState: 'idle' | 'loading';
  pendingRequests: number;
  /** @e 引用代际号，由主进程在每次成功 observe 后颁发；act 需携带校验（STALE_REF）。 */
  documentGeneration: number;
  /** 感知模式：dom=注入脚本遍历；ax=CDP Accessibility 树（异常时回退 dom 并如实标注）。 */
  observationMode: 'dom' | 'ax';
  /** AX 预算截断/降级标记。 */
  truncated?: boolean;
  /** 自上次 observe 以来被接管的 JS dialog 记录。 */
  dialogs?: BrowserAutomationDialogRecord[];
}

export interface BrowserAutomationObserveOptions {
  /** 感知模式；缺省取 A3 的 level（env 级，见 feature-flag.getBrowserAutomationLevel）。 */
  mode?: 'dom' | 'ax';
  /** AX 模式：只保留交互节点（子树含交互节点的祖先链保留）。 */
  interactiveOnly?: boolean;
  /** AX 模式：对该 ref（collapsed 子树）做下钻抓取。 */
  ref?: string;
}

export interface BrowserAutomationSession {
  sessionId: string;
  source: BrowserAutomationSessionSource;
  embedRuntimeId?: string;
  url: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  automationPinned: boolean;
  /** owned=自动化创建可销毁；borrowed=用户 tab 只借不毁（embed）。 */
  ownership: 'owned' | 'borrowed';
}

export interface BrowserAutomationActPayload {
  ref?: string;
  stableKey?: string;
  name?: string;
  action: BrowserAutomationAction;
  value?: string;
  url?: string;
  key?: string;
  scrollY?: number;
  /** 携带最近一次 observe 拿到的 documentGeneration；不匹配即 STALE_REF。 */
  generation?: number;
  /** 默认 true；false 跳过动作后 300ms 自动快照。 */
  snapshot?: boolean;
}

export interface BrowserAutomationWaitCondition {
  type: 'networkIdle' | 'url' | 'selector' | 'timeout' | 'navigation';
  urlPattern?: string;
  selector?: string;
  stableKey?: string;
  timeoutMs?: number;
}

export interface BrowserAutomationValidatorSpec {
  type: 'url' | 'title' | 'elementExists' | 'elementCount' | 'elementText' | 'networkIdle';
  pattern?: string;
  stableKey?: string;
  ref?: string;
  name?: string;
  role?: string;
  minCount?: number;
  maxCount?: number;
  expectedText?: string;
  timeoutMs?: number;
}

export interface BrowserAutomationValidatorResult {
  passed: boolean;
  type: string;
  message: string;
}

export interface BrowserAutomationActResult {
  success: boolean;
  action: BrowserAutomationAction;
  ref?: string;
  stableKey?: string;
  error?: string;
  /** 结构化错误码（STALE_REF / DIALOG_STORM / PAGE_NOT_VISIBLE / CLICK_* 等）；普通失败仅填 error 文案。 */
  errorCode?: BrowserAutomationErrorCode;
  /** click 遮挡检测（A2）：elementFromPoint 命中非目标/非祖先元素时为 true。 */
  occluded?: boolean;
  /** 遮挡元素描述（tag#id.class 摘要）。 */
  occluder?: string;
  /** click 降级链（B7）：实际生效的投递路径（js=页内 el.click()；cdp=CDP 坐标三连）。 */
  via?: 'js' | 'cdp';
  /** click 降级链（B7）：投递探针确认事件到达目标或其交互祖先。 */
  probeDelivered?: boolean;
  /** 产物类 act 动作（screenshot/print_pdf）落盘后的产物引用。 */
  artifact?: BrowserAutomationArtifactRef;
  /** 本次 act 窗口内被接管/记录的 JS dialog（B2 dialog-guard 产出）。 */
  dialogs?: BrowserAutomationDialogRecord[];
  observation?: BrowserAutomationPageObservation;
  /** network_capture start 返回的 captureId。 */
  captureId?: string;
}

/** 落盘产物引用：二进制只写文件系统，DB（ba_artifact）只登记元数据。 */
export interface BrowserAutomationArtifactRef {
  /** sha256 前 16 位 + 时间基，禁止含路径分隔符（白名单 /^[A-Za-z0-9-]+$/）。 */
  artifactId: string;
  /** 绝对路径（仅本机展示/读取）。 */
  path: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  /** ISO 时间戳。 */
  createdAt: string;
}

export interface BrowserAutomationFindQuery {
  text?: string;
  role?: string;
  name?: string;
  /** 默认 true。 */
  interactiveOnly?: boolean;
  /** 默认 20。 */
  maxResults?: number;
}

export interface BrowserAutomationFindMatch {
  ref: string;
  stableKey: string;
  role: string;
  name: string;
  /** 静态文本命中时上溯的最近可交互祖先 ref（可点击目标）。 */
  interactiveAncestorRef?: string;
  /** 命中的祖先链（根 → 父，≤6 层），供 LLM 定位上下文。 */
  path?: Array<{ ref?: string; role: string; name: string }>;
  boundingBox?: BrowserAutomationBoundingBox;
}

export interface BrowserAutomationFindResult {
  matches: BrowserAutomationFindMatch[];
  documentGeneration: number;
  truncated: boolean;
  /** 截断时的总命中数（> matches.length 说明被 maxResults 截断）。 */
  totalMatches?: number;
  /** 超出 maxResults 时给 LLM 的缩小检索提示。 */
  hint?: string;
}

export interface BrowserAutomationReadPageOptions {
  /** 默认 BROWSER_AUTOMATION_READ_PAGE_MAX_PAGES。 */
  maxPages?: number;
  /** 默认 viewport 高 × 0.85（BROWSER_AUTOMATION_READ_PAGE_STEP_RATIO）。 */
  pixelPerPage?: number;
  includeArtifact?: boolean;
  /** 分页续读起点（上一页返回的 nextStart）。 */
  startOffset?: number;
}

export interface BrowserAutomationReadPageResult {
  text: string;
  pages: number;
  /** 滚动冻结检测命中（连续无新增 / rAF 冻结）。 */
  frozen: boolean;
  truncated: boolean;
  /** 分页语义：true=已读到底且无截断；false 时携带 nextStart 续读。 */
  complete: boolean;
  /** 下次续读的字符偏移（complete=true 时缺省）。 */
  nextStart?: number;
  artifact?: BrowserAutomationArtifactRef;
}

export interface BrowserAutomationNetworkCaptureOptions {
  /** 正则。 */
  urlFilter?: string;
  /** 默认 500。 */
  maxEntries?: number;
  /** 默认 2 * 1024 * 1024。 */
  maxTotalBodyBytes?: number;
  /** 默认 false。 */
  includeBodies?: boolean;
}

export interface BrowserAutomationNetworkCaptureStartResult {
  captureId: string;
}

export interface BrowserAutomationNetworkEntrySummary {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  encodedBytes?: number;
  bodyBytes?: number;
  bodyArtifactId?: string;
  bodySkipped?: boolean;
  errorText?: string;
}

export interface BrowserAutomationNetworkCaptureStopResult {
  captureId: string;
  entries: BrowserAutomationNetworkEntrySummary[];
  truncated: boolean;
  artifact?: BrowserAutomationArtifactRef;
}

/** printToPdf 选项（B4/C1：对应 webContents.printToPDF 参数子集）。 */
export interface BrowserAutomationPrintPdfOptions {
  /** 默认 true。 */
  printBackground?: boolean;
  landscape?: boolean;
  pageRanges?: string;
  scale?: number;
}

/** captureScreenshot 选项（B4/C1：ref → 元素 clip，调用方内部先 scrollIntoView）。 */
export interface BrowserAutomationScreenshotOptions {
  /** 元素 ref（@eN）：滚动到该元素并只截其区域。 */
  ref?: string;
  format?: 'png' | 'jpeg';
  /** 仅 jpeg。 */
  quality?: number;
}

export const BROWSER_AUTOMATION_COMMAND_TIMEOUT_MS = 120_000;
export const BROWSER_AUTOMATION_SESSION_IDLE_MS = 30 * 60 * 1000;
export const BROWSER_AUTOMATION_NETWORK_IDLE_MS = 800;
export const BROWSER_AUTOMATION_MAX_ELEMENTS = 120;

/**
 * AX 观察预算（B6）：按序列化后的元素清单字符数计量（ref/role/name/value/bbox 摘要），
 * 超预算触发三轮降级（子树折叠 → 尾部弹出 → 字段长度减半）。
 * 注：常量名沿计划文档 §四 A1 的 NODE_BUDGET 命名，计量口径为字符（与 §四 B6 的
 * "60k 节点预算"语义对齐——单节点摘要均摊 ~1kB 字符量级）。
 */
export const BROWSER_AUTOMATION_AX_NODE_BUDGET = 60_000;
/** AX bbox 补齐：DOM.getContentQuads 每批并发的 backendNodeId 数。 */
export const BROWSER_AUTOMATION_AX_QUADS_BATCH = 100;
/** 动作后自动快照的等待时长。 */
export const BROWSER_AUTOMATION_POST_ACTION_SNAPSHOT_MS = 300;
/** 单条 CDP 命令默认超时（串行化队列的防堵死硬约束）。 */
export const BROWSER_AUTOMATION_CDP_TIMEOUT_MS = 30_000;
/** JS dialog 风暴熔断阈值：窗口内超此数量即熔断。 */
export const BROWSER_AUTOMATION_DIALOG_STORM_LIMIT = 10;
export const BROWSER_AUTOMATION_DIALOG_STORM_WINDOW_MS = 5_000;
/** read_page 滚动收集的屏数上限（60 屏）。 */
export const BROWSER_AUTOMATION_READ_PAGE_MAX_PAGES = 60;
export const BROWSER_AUTOMATION_READ_PAGE_MAX_CHARS = 24_000;
/** read_page 每屏步进比例（相对 viewport 高）。 */
export const BROWSER_AUTOMATION_READ_PAGE_STEP_RATIO = 0.85;
/** read_page 每步滚动后的文本增长观察窗口。 */
export const BROWSER_AUTOMATION_READ_PAGE_SETTLE_MS = 400;
/** read_page 虚拟列表去重：相邻批交界行级重叠检测上限。 */
export const BROWSER_AUTOMATION_READ_PAGE_OVERLAP_LINES = 100;
/** read_page rAF 冻结探针：超时无帧即判 renderFrozen。 */
export const BROWSER_AUTOMATION_READ_PAGE_RAF_TIMEOUT_MS = 1_000;
export const BROWSER_AUTOMATION_NETWORK_RING_MAX_ENTRIES = 500;
export const BROWSER_AUTOMATION_NETWORK_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** 抓包单条 body 内联上限：超出走 artifact 落盘（bodyArtifactId）。 */
export const BROWSER_AUTOMATION_NETWORK_SINGLE_BODY_MAX_BYTES = 256 * 1024;
