# Tasks: 应用开发工作台 MVP

## 1. Node 运行时托管（service-node-runtime）

- [x] 1.1 新增 `electron/utils/node-runtime-info.ts`：版本 pin、平台归档名、三级源 URL 构造、SHASUMS256 解析（纯函数，可单测）（Requirement: Runtime download with mirror fallback and integrity check）
- [x] 1.2 新增 `electron/utils/node-runtime.ts`：托管目录解析、就绪检查、下载（Electron net，尊重系统代理）、校验、临时目录解压 + 原子改名、单飞锁、状态/进度导出（Requirement: Managed Node runtime resolution; Setup progress reporting and single-flight）
- [x] 1.3 单元测试 `tests/unit/node-runtime-info.test.ts`：URL 构造、归档名、SHASUMS 解析、状态机纯逻辑（Requirement: Runtime download with mirror fallback and integrity check）
- [x] 1.4 Host API 路由暴露状态查询与 setup 触发（Requirement: Setup progress reporting and single-flight）

## 2. 模板与创建（app-create-scaffold）

- [x] 2.1 新增内置模板 `resources/app-templates/react-vite/`：monorepo 结构、`.npmrc`（snpm）、`docs/api/` 占位（Requirement: Monorepo template content）
- [x] 2.2 新增 scaffold 服务：模板拷贝 + 变量替换 + `git init` 首 commit（git 可用时）+ session-catalog workspace + 项目 Agent（Requirement: One-step app creation wizard）
- [x] 2.3 后台 `npm install` 编排（托管 Node + `npm_config_cache`），阶段进度上报（Requirement: Background dependency installation）
- [x] 2.4 创建向导 UI（含目录非空校验、暗色模式验证、检查硬编码 light-only 颜色）（Requirement: One-step app creation wizard）

## 3. dev server 管理（service-dev-server）

- [x] 3.1 新增 dev-server-manager：注册表、空闲端口分配、spawn、HTTP 探活、日志环形缓冲（Requirement: Dev server lifecycle management; Log capture and crash recovery）
- [x] 3.2 崩溃退避重启与失败升级（Requirement: Log capture and crash recovery）
- [x] 3.3 `before-quit` 进程树清理（Windows `taskkill /T`）（Requirement: Process cleanup on shutdown）
- [x] 3.4 Host API 路由：start/stop/status + 就绪事件（Requirement: Dev server lifecycle management）

## 4. 工作台（app-dev-workbench）

- [x] 4.1 工作台页面：Chat（项目 Agent）+ webview 预览分栏 + 状态条（语义 token，暗色模式验证）（Requirement: Chat-plus-preview workbench layout）
- [x] 4.2 host-api 封装全部新能力，页面不直接 IPC（Requirement: Renderer accesses all capabilities through host-api）
- [x] 4.3 就绪自动加载预览；连续进度呈现（准备环境/安装/启动/就绪）（Requirement: Chat-plus-preview workbench layout）
- [x] 4.4 错误回流：编译/运行错误注入 Agent 对话 + "正在修复"状态（Requirement: Error feedback loop to agent）
- [x] 4.5 运行状态菜单支持停止/启动/重启；自然语言重启并按新 preview URL 重建预览（Requirement: Chat-plus-preview workbench layout）

## 5. 本地 checkpoint（service-git-checkpoint）

- [x] 5.1 git 能力探测与降级（Requirement: Graceful degradation without git）
- [x] 5.2 Agent 轮次结束自动 commit（Requirement: Automatic checkpoint per agent turn）
- [x] 5.3 恢复上一版（备份引用 + restore + 预览刷新）与工作台入口（Requirement: One-click restore to previous checkpoint）

## 6. 验证与收尾

- [ ] 6.1 `pnpm run lint`、`pnpm run typecheck`、`pnpm test` 全绿（新文件 lint/单测已绿；全仓 typecheck 受存量 dist-electron 缺失影响）
- [ ] 6.2 手动验收：创建 → 首预览 < 3 分钟（含环境准备）；对话改页面实时生效；恢复上一版有效；退出无残留进程
- [ ] 6.3 暗色模式走查全部新 UI
- [ ] 6.4 Review `README.md`、`README.zh-CN.md`、`README.ja-JP.md` 是否需同步更新
- [ ] 6.5 （外部）基建内网源挂载 Node 便携包 + SHASUMS；挂载前 npmmirror 为第一源
