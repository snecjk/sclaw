# Design: 应用开发工作台 MVP

## 关键决策

### D1. Node 运行时：运行时下载托管，统一使用托管版本

- **决策**：首次需要时从镜像下载便携版 Node 22 LTS（pin 精确版本）到 `~/.stoclaw/runtime/node/v<ver>/`，所有用户项目命令以绝对路径使用托管 Node/npm；即使系统存在 Node 也不使用。
- **理由**：目标用户机器大概率无 Node；打包预捆绑会使安装包增大 40MB+ 且需改打包配置（工程红线）；统一托管版本使模板/组件库/Vite 行为完全可预测。参照已在线上验证的 uv/Python 托管模式（`electron/utils/uv-setup.ts`）。
- **备选**：a) 打包预捆绑——安装包膨胀、动打包脚本，否决；b) 优先系统 Node——引入版本漂移支持成本，否决；c) 用 Electron 自带 Node 跑 Vite——用户项目进程与主应用耦合，否决。
- 下载源三级降级（复用 `shouldOptimizeNetwork()` 区域探测）：公司内网源（待基建挂载，URL 可配置）→ npmmirror `registry.npmmirror.com/-/binary/node/` → 官方 nodejs.org。下载校验官方 `SHASUMS256.txt`；临时目录解压后原子改名；单飞锁防并发（同 `setupManagedPythonPromise` 模式）；下载走 Electron `net` 以尊重系统代理。

### D2. 模板：客户端内置快照，monorepo 结构

- **决策**：MVP 模板以静态文件形式内置于客户端（`resources/app-templates/react-vite/`），结构为 monorepo（`frontend/` + 占位 `backend/` + `docs/api/` + 根 `.npmrc` 指向 snpm）。
- **理由**：MVP 无 GitLab 依赖；模板仓库化（GitLab 托管 + 客户端兜底快照）在 P1 与 GitLab 集成一并落地。
- **备选**：create-vite 在线脚手架——依赖公网与额外下载，且无法预置公司组件库/接口文档，否决。

### D3. dev server 管理：Main 进程集中管理器

- **决策**:Main 进程新增 dev-server-manager：注册表管理各应用的进程（spawn Vite，注入托管 Node PATH 与 `npm_config_cache=~/.stoclaw/npm-cache`）、空闲端口分配、HTTP 探活就绪通知、stdout/stderr 环形缓冲、异常退出带退避重启、`before-quit` 终止全部进程树。
- **理由**：进程生命周期必须收敛在 Main（Renderer 无权限）；集中注册表保证退出必杀、多应用端口不冲突。
- **备选**：由项目 Agent 用 shell 工具启动——进程脱管、退出残留，否决。
- **[Risk]** 子进程残留拖慢用户机器 → Mitigation：注册表 + 进程树 kill（Windows `taskkill /T`），`before-quit` 与应用关闭双钩子，启动前清理同端口遗留。

### D4. 工作台：复用 Chat 与 webview，错误自动回流

- **决策**：工作台 = 左侧现有 Chat（绑定项目 Agent）+ 右侧现有 webview 容器加载 `http://localhost:<port>`。Vite 编译错误与页面 console error 经 Main 采集后作为系统消息注入对话触发 Agent 自修复；用户界面只显示"正在修复"状态。
- **理由**：对话与预览容器均为成熟能力；错误闭环是"业务人员不读日志"体验的关键。
- **备选**：新建独立编辑器/终端界面——与用户画像冲突，否决。
- UI 全部使用 `docs/sto-design.md` 语义 token（状态色用 Functional 系），明确暗色模式行为，禁止 light-only 硬编码色。

### D5. 本地 checkpoint：git 实现，用户无 Git 术语感知

- **决策**：scaffold 时 `git init` + 首个 commit；Agent 每轮改动结束后自动 commit（message 含轮次摘要）；"恢复上一版" = 基于 checkpoint 的 revert/reset（恢复前自动创建备份分支）。MVP 使用系统 git（macOS 自带；无 git 时 checkpoint 能力降级隐藏，不阻塞开发），Windows 托管 MinGit 随 P1 git 集成落地。
- **理由**：git 天然提供历史与回滚且与 P1 GitLab 同步无缝衔接；"AI 改坏了"是最高频挫败场景，一键恢复必须进 MVP。
- **备选**：自研快照目录拷贝——大目录（node_modules 需排除）易错且与 P1 割裂，否决。
- **[Risk]** 用户机器无 git（主要 Windows）→ Mitigation：能力探测 + UI 降级（隐藏回滚入口并提示），P1 托管 MinGit 补齐。

## 通信与边界

- Renderer 仅经 `src/lib/host-api.ts` 新增封装调用；Main 侧以 Host API 路由（`electron/api/routes/`）暴露：创建应用、环境状态/进度、dev server start/stop/status、checkpoint list/restore。
- 不新增 Renderer 直接 `ipcRenderer.invoke`；预览加载 localhost 属 webview 现有能力，不涉及 Gateway 传输策略变更。
- 进度类事件（下载/install/dev server 日志）由 Main 推送，复用现有事件通道模式。

## 风险汇总

- **[Risk]** 首次体验耗时（下载 Node + npm install）→ Mitigation：进入创建入口即后台预热下载；连续单进度条呈现；`npm_config_cache` 收敛复用。
- **[Risk]** 用户处于内网外，snpm 不可达 → Mitigation：install 失败给出明确网络提示并可重试；npm 源保留 npmmirror 降级项。
- **[Risk]** 端口探活误判（服务未就绪即加载预览）→ Mitigation：HTTP 200 探活 + 重试窗口，超时转 Agent 诊断。
