# StoClaw Windows 安装速度优化分析报告

## 执行摘要

| 指标 | 当前值 | 目标值 |
|------|--------|--------|
| 安装时间 | 3+ 分钟 | < 1 分钟 |
| 安装包大小 (x64) | 443.65 MB | ~400 MB |
| 安装包大小 (arm64) | 206.34 MB | ~180 MB |
| 解压文件数量 | 19,342 个 | < 5,000 个 |

**核心问题**：OpenClaw 运行时的 `node_modules` 目录包含 **17,393 个文件**，未打包进 ASAR，导致 NSIS 安装器需要逐个解压近 2 万个文件，这是安装缓慢的根本原因。

---

## 1. 当前状态分析

### 1.1 安装包构成

| 组件 | 大小 | 文件数 | 占比 |
|------|------|--------|------|
| openclaw/ | 262.54 MB | 17,393 | 58.1% |
| bin/ (node.exe + uv.exe) | 121.98 MB | 2 | 27.0% |
| openclaw-plugins/ | 56.78 MB | 1,921 | 12.6% |
| resources/ | 0.72 MB | 20 | 0.2% |
| cli/ | 0.006 MB | 3 | ~0% |
| **合计** | **451.77 MB** | **19,342** | **100%** |

### 1.2 已实施的优化

| 优化项 | 状态 | 效果 |
|--------|------|------|
| compression: normal (Deflate) | ✅ 已完成 | 安装时间从 3-5 分钟降至 1-3 分钟 |
| afterPack 清理无用文件 | ✅ 已完成 | 减少约 5-10% 体积 |
| 平台特定原生模块清理 | ✅ 已完成 | 每平台节省约 10-20 MB |

### 1.3 配置现状

```yaml
# electron-builder.yml 当前配置
compression: normal  # 已从 maximum 改为 normal
asar: true           # 仅对 Electron 主进程生效
```

**问题**：`openclaw/` 目录作为 `extraResources` 打包，未进入 ASAR，导致大量小文件独立存储。

---

## 2. 根本原因分析

### 2.1 为什么 OpenClaw 不进 ASAR？

1. **原生模块兼容性**：OpenClaw 依赖大量原生模块（sharp, koffi, @node-llama-cpp 等），这些模块包含 `.node` 二进制文件
2. **独立进程运行**：OpenClaw 作为独立 Node.js 进程运行，需要直接访问文件系统
3. **历史原因**：初期设计时为简化打包流程

### 2.2 NSIS 解压性能瓶颈

```
NSIS 安装流程:
1. 读取安装包头部
2. 逐个文件解压:
   - 创建目录结构
   - 解压单个文件
   - 写入磁盘
   - 设置文件属性
3. 执行后处理脚本
```

**关键点**：每个文件的解压都有固定开销（目录查找、文件创建、属性设置），文件数量是影响安装速度的主要因素。

### 2.3 性能对比估算

| 场景 | 文件数 | 预计安装时间 |
|------|--------|--------------|
| 当前状态 | 19,342 | 2-3 分钟 |
| 减少 50% 文件 | ~10,000 | 1-1.5 分钟 |
| 减少 80% 文件 | ~4,000 | 30-45 秒 |
| 单一 ASAR 包 | ~100 | < 30 秒 |

---

## 3. 优化方案

### 3.1 方案一：禁用 NSIS Solid Compression（✅ 已实施）

**原理**：NSIS 默认使用 Solid Compression（将所有文件作为一个整体压缩），禁用后每个文件独立压缩，虽体积略增但安装更快。

**修改**：

在 [scripts/installer.nsh](../scripts/installer.nsh) 开头添加：

```nsis
; Disable solid compression for faster installation.
; Solid compression (default) treats all files as one block - faster to compress
; but much slower to extract, especially for apps with many small files.
; Using zlib (non-solid) allows individual file extraction and parallel I/O,
; reducing install time by 20-30% at the cost of ~5-10% larger installer size.
SetCompressor zlib
```

**预期效果**：
- 安装时间：减少 20-30%
- 体积增加：5-10%

**风险**：低，已验证可用

---

### 3.2 方案二：OpenClaw 打包进 ASAR（中期实施）

**原理**：将 `openclaw/` 目录整体打包成一个 `.asar` 文件，NSIS 只需解压一个文件。

**挑战**：

1. **原生模块处理**：需要使用 `asarUnpack` 排除 `.node` 文件
2. **路径兼容性**：OpenClaw 需要支持从 ASAR 内读取文件
3. **动态加载**：部分模块可能使用动态 `require`，需要特殊处理

**实施方案**：

```yaml
# electron-builder.yml 修改
extraResources:
  # 移除 openclaw/ 的独立打包
  # - from: build/openclaw/
  #   to: openclaw/

# 将 openclaw 加入 ASAR
files:
  - dist
  - dist-electron
  - package.json
  - build/openclaw/**  # 新增

asarUnpack:
  - "**/*.node"
  - "build/openclaw/**/node_modules/**/*.node"  # 排除原生模块
```

**预期效果**：
- 安装时间：减少 70-80%（< 30 秒）
- 体积：基本不变
- 文件数：从 19,342 减少到约 100-200 个

**风险评估**：

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 原生模块加载失败 | 中 | 高 | 充分测试所有插件 |
| 动态 require 路径问题 | 低 | 中 | 代码审查 + 集成测试 |
| OpenClaw 启动变慢 | 低 | 低 | ASAR 读取性能实际更好 |

---

### 3.3 方案三：按需下载组件（中期实施）

**原理**：安装包只包含核心组件，大型二进制文件（Node.js、uv、插件）在首次启动时下载。

**实施步骤**：

1. **分离大型组件**：
   - Node.js (72.65 MB) → 首次启动下载
   - uv (49.33 MB) → 首次启动下载
   - 插件 (56.78 MB) → 按需下载

2. **实现下载逻辑**：
```typescript
// electron/services/component-downloader.ts
async function ensureComponent(name: string): Promise<string> {
  const componentPath = getComponentPath(name);
  if (existsSync(componentPath)) return componentPath;
  
  await downloadComponent(name, componentPath);
  return componentPath;
}
```

3. **用户体验优化**：
   - 首次启动显示下载进度
   - 支持离线模式（使用本地缓存）
   - 断点续传

**预期效果**：
- 初始安装包大小：约 150 MB（减少 65%）
- 安装时间：< 30 秒
- 首次启动时间：增加 1-2 分钟（下载）

**风险**：
- 需要稳定的 CDN
- 离线场景体验差
- 防火墙/代理问题

---

### 3.4 方案四：提供便携版（立即实施）

**原理**：提供 ZIP 便携版，用户直接解压使用，无需安装器。

**实施**：

```yaml
# electron-builder.yml
win:
  target:
    - target: nsis
      arch: x64
    - target: nsis
      arch: arm64
    - target: portable  # 新增便携版
      arch: x64
    - target: portable
      arch: arm64
```

**预期效果**：
- 解压时间：约 30-60 秒
- 用户控制：可选择安装位置
- 适合：高级用户、便携使用场景

---

### 3.5 方案五：依赖精简（长期实施）

**原理**：分析并移除 OpenClaw 中不必要的依赖。

**当前依赖数量**：418 个包

**优化方向**：

1. **Tree-shaking 分析**：
   - 使用 `depcheck` 或 `npm-check` 扫描未使用的依赖
   - 分析 OpenClaw 实际加载路径

2. **可选依赖拆分**：
   - 将消息平台插件改为按需安装
   - AI Provider 实现按需加载

3. **替代方案**：
   - 用轻量级库替代重型库
   - 移除重复功能的包

**预期效果**：
- 体积减少：20-30%
- 文件数减少：30-40%

---

## 4. 推荐实施路径

### 阶段一：立即可实施（1-2 天）

| 任务 | 状态 | 预期收益 |
|------|------|----------|
| 提供便携版 | 待实施 | 高级用户体验改善 |
| 禁用 Solid Compression | ✅ 已完成 | 安装速度提升 20-30% |

### 阶段二：短期优化（1-2 周）

| 任务 | 工作量 | 预期收益 |
|------|--------|----------|
| OpenClaw ASAR 打包测试 | 中 | 安装时间 < 1 分钟 |
| 兼容性测试 | 中 | 确保稳定运行 |

### 阶段三：中期优化（1-2 月）

| 任务 | 工作量 | 预期收益 |
|------|--------|----------|
| 按需下载组件 | 高 | 初始安装包 < 200 MB |
| 依赖精简 | 高 | 体积减少 20-30% |

---

## 5. 技术实施细节

### 5.1 OpenClaw ASAR 打包实施步骤

```bash
# 1. 修改 electron-builder.yml
# 2. 测试构建
pnpm run package:win

# 3. 验证原生模块
# 检查 app.asar.unpacked 目录内容

# 4. 功能测试
# - 启动应用
# - 测试各平台插件
# - 测试 AI Provider
```

### 5.2 需要排除 ASAR 的模式

```yaml
asarUnpack:
  # Electron 主进程原生模块
  - "**/*.node"
  
  # OpenClaw 原生模块
  - "build/openclaw/**/koffi/**/*.node"
  - "build/openclaw/**/sharp/**/*.node"
  - "build/openclaw/**/@node-llama-cpp/**/*.node"
  - "build/openclaw/**/sqlite-vec*/*.node"
  
  # 配置文件（需要写入）
  - "build/openclaw/**/*.json"
```

### 5.3 OpenClaw 代码修改

需要确保 OpenClaw 支持 ASAR 路径：

```javascript
// Node.js 内置支持 ASAR，但需要处理以下场景：

// 1. 动态 require 路径
const modulePath = require.resolve('./some-module');  // ✅ 自动处理

// 2. 文件系统操作
fs.readFile(path.join(__dirname, 'config.json'));  // ✅ 自动处理

// 3. 子进程启动（需要特殊处理）
const openclawPath = process.resourcesPath + '/openclaw';
// 如果 openclaw 在 ASAR 内，需要解压到 app.asar.unpacked
```

---

## 6. 测试验证清单

### 6.1 功能测试

- [ ] 应用正常启动
- [ ] OpenClaw Gateway 启动成功
- [ ] 所有预装技能正常加载
- [ ] 消息平台插件正常工作
  - [ ] DingTalk
  - [ ] WeCom
  - [ ] QQ
  - [ ] WeChat
- [ ] AI Provider 正常调用
  - [ ] OpenAI
  - [ ] Anthropic
  - [ ] 其他 Provider
- [ ] 设置持久化正常
- [ ] 自动更新正常

### 6.2 性能测试

- [ ] 首次启动时间
- [ ] 内存占用
- [ ] CPU 占用
- [ ] 安装时间对比

### 6.3 兼容性测试

- [ ] Windows 10 x64
- [ ] Windows 11 x64
- [ ] Windows 11 ARM64
- [ ] 长路径场景
- [ ] 非英文路径场景

---

## 8. 首次启动速度优化（✅ 已实施）

### 8.1 问题分析

第一次启动时窗口显示慢的原因：

| 阶段 | 操作 | 问题 |
|------|------|------|
| ~~主进程初始化~~ | ~~`await initTelemetry()`~~ | ~~第一次启动需要网络请求 PostHog~~ |
| 主进程初始化 | `await applyProxySettings()` | 读取配置并设置代理 |
| 窗口加载 | `index.html` 空白 | 无加载动画，用户看到空白 |
| 前端初始化 | 多个 store `init()` | 需要调用后端 API |

**用户体验问题**：点击图标 → 长时间无反应 → 用户以为程序没启动

### 8.1.1 遥测已默认关闭

遥测初始化曾是冷启动慢的主要原因之一。现在已**默认关闭遥测**：

| 设置项 | 之前 | 之后 |
|--------|------|------|
| `telemetryEnabled` 默认值 | `true` | `false` |

**效果**：
- 冷启动不再等待遥测网络请求
- 用户可在 **设置 > 高级** 中手动开启遥测
- 开启遥测后会发送匿名使用数据帮助改进产品

### 8.2 实施的优化

#### 8.2.1 添加启动画面（Splash Screen）

在 [index.html](../index.html) 中添加启动画面，在 React 加载前显示：

```html
<div id="splash-screen">
  <svg class="splash-logo">...</svg>
  <div class="splash-text">StoClaw</div>
  <div class="splash-spinner"></div>
  <div id="splash-progress" class="splash-progress"></div>
</div>
```

**效果**：
- 用户点击图标后立即看到启动画面
- 显示 logo 和加载动画，提供视觉反馈
- React 加载完成后平滑淡出

#### 8.2.2 添加进度提示

在启动画面下方显示当前正在执行的操作：

| 进度消息 | 对应操作 |
|----------|----------|
| `Loading settings...` | 加载代理设置 |
| `Installing built-in skills...` | 安装内置技能 |
| `Installing skills...` | 安装预装技能 |
| `Installing plugins...` | 安装插件 |
| `Starting Gateway...` | 启动 OpenClaw Gateway |
| `Finalizing...` | 完成初始化 |

**实现方式**：
- 主进程通过 `sendStartupProgress()` 发送 IPC 消息
- 启动画面的 JavaScript 监听并更新文字
- React 加载后自动隐藏

#### 8.2.3 优化主进程启动顺序

在 [electron/main/index.ts](../electron/main/index.ts) 中调整初始化顺序：

**之前**：
```
await initTelemetry() → await applyProxySettings() → 创建窗口
```

**之后**：
```
创建窗口 → 并行执行 initTelemetry() + applyProxySettings()
```

**关键改动**：
- 窗口创建提前到最前面
- 遥测初始化改为非阻塞
- 代理设置并行执行
- 非关键设置同步异步化

### 8.3 预期效果

| 指标 | 之前 | 之后 |
|------|------|------|
| 首次可见时间 | 3-5 秒 | < 1 秒 |
| 用户感知 | "程序没反应" | 立即看到启动画面 |
| 实际可用时间 | 不变 | 略快（并行初始化）|

---

## 9. 附录

### 7.1 文件分布详情

```
resources/
├── openclaw/                    # 262.54 MB, 17,393 files
│   ├── node_modules/            # 418 packages
│   │   ├── @img/               # Sharp 图像处理
│   │   ├── @node-llama-cpp/    # LLM 推理
│   │   ├── koffi/              # FFI 库 (18 平台预编译)
│   │   ├── sharp/              # 图像处理
│   │   └── ... (400+ packages)
│   └── ...
├── bin/                         # 121.98 MB, 2 files
│   ├── node.exe                # 72.65 MB
│   └── uv.exe                  # 49.33 MB
├── openclaw-plugins/            # 56.78 MB, 1,921 files
│   └── dingtalk/               # 钉钉插件
└── resources/                   # 0.72 MB, 20 files
```

### 7.2 相关配置文件

| 文件 | 用途 |
|------|------|
| [electron-builder.yml](../electron-builder.yml) | 打包配置 |
| [scripts/after-pack.cjs](../scripts/after-pack.cjs) | 打包后处理 |
| [scripts/installer.nsh](../scripts/installer.nsh) | NSIS 自定义脚本 |
| [docs/WINDOWS_BUILD_PROCESS.md](./WINDOWS_BUILD_PROCESS.md) | 打包流程文档 |

### 7.3 参考资源

- [electron-builder ASAR 文档](https://www.electron.build/configuration/configuration#configuration-asar)
- [NSIS 用户手册](https://nsis.sourceforge.io/Docs/)
- [Electron ASAR 文档](https://www.electronjs.org/docs/latest/tutorial/asar-overview)
