# StoClaw Windows 打包过程分析

## 概述

StoClaw 是一个基于 Electron + React + Vite 的跨平台桌面应用，为 OpenClaw AI 运行时提供图形界面。本文档详细分析其在 Windows 环境下的完整打包流程。

---

## 1. 技术栈与工具链

| 组件 | 技术选型 |
|------|----------|
| 前端框架 | React 19 + TypeScript |
| 构建工具 | Vite 7.x |
| Electron | 40.6.0 |
| 打包工具 | electron-builder 26.8.1 |
| 包管理器 | pnpm 10.31.0 (固定版本) |
| 安装器 | NSIS |
| 运行时 | OpenClaw (Python + Node.js) |
| 依赖管理 | uv (Python) + bundled Node.js |

---

## 2. 打包命令总览

### 2.1 主要命令

```bash
# 完整打包流程（推荐）
pnpm run package:win

# 手动分步执行
pnpm run prep:win-binaries    # 下载 Windows 二进制文件
pnpm run package              # 前端构建 + OpenClaw 打包
pnpm electron-builder --win --publish never  # electron-builder 打包
```

### 2.2 命令执行顺序

```
package:win
├── prep:win-binaries
│   ├── uv:download:win       # 下载 uv (x64 + arm64)
│   └── node:download:win     # 下载 Node.js (x64 + arm64)
├── package
│   ├── vite build            # 前端构建
│   ├── bundle-openclaw.mjs   # 打包 OpenClaw 运行时
│   ├── bundle-openclaw-plugins.mjs  # 打包插件
│   └── bundle-preinstalled-skills.mjs  # 打包预装技能
└── electron-builder --win --publish never
```

---

## 3. 打包流程详解

### 3.1 Phase 1: 前端构建 (Vite)

**命令**: `vite build`

**配置文件**: [vite.config.ts](../vite.config.ts)

**构建产物**:
- `dist/` - 前端静态资源
- `dist-electron/main/` - Electron 主进程代码
- `dist-electron/preload/` - 预加载脚本

**关键配置**:
```typescript
// vite.config.ts
{
  base: './',  // Electron 使用 file:// 协议，必须使用相对路径
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    react(),
    electron([
      { entry: 'electron/main/index.ts', outDir: 'dist-electron/main' },
      { entry: 'electron/preload/index.ts', outDir: 'dist-electron/preload' },
    ]),
  ],
}
```

---

### 3.2 Phase 2: OpenClaw 运行时打包

**脚本**: [scripts/bundle-openclaw.mjs](../scripts/bundle-openclaw.mjs)

**目的**: 将 OpenClaw npm 包及其所有传递依赖打包成自包含目录

**输出目录**: `build/openclaw/`

**处理流程**:

```
1. 解析 pnpm 虚拟存储中的 openclaw 真实路径
2. BFS 遍历所有传递依赖
3. 扁平化复制到 build/openclaw/node_modules/
4. 清理无用文件（类型定义、源码映射、文档等）
5. 修补损坏的模块（node-domexception 等）
6. 修补 Windows spawn 调用（添加 windowsHide: true）
```

**pnpm 虚拟存储结构**:
```
node_modules/.pnpm/
├── openclaw@2026.3.13/
│   └── node_modules/
│       ├── openclaw/        <- 真实文件
│       ├── chalk/ -> symlink
│       └── @clack/prompts/ -> symlink
└── chalk@5.4.1/
    └── node_modules/
        └── chalk/           <- 真实文件
```

**跳过的包**:
- `typescript` - 开发依赖
- `@playwright/test` - 测试依赖
- `@discordjs/opus` - Electron ABI 不兼容

---

### 3.3 Phase 3: OpenClaw 插件打包

**脚本**: [scripts/bundle-openclaw-plugins.mjs](../scripts/bundle-openclaw-plugins.mjs)

**输出目录**: `build/openclaw-plugins/`

**打包的插件**:

| npm 包名 | 插件 ID |
|----------|---------|
| @soimy/dingtalk | dingtalk |
| @wecom/wecom-openclaw-plugin | wecom |
| @sliverp/qqbot | qqbot |
| @tencent-weixin/openclaw-weixin | openclaw-weixin |

**处理逻辑**:
1. 从 node_modules 解析插件真实路径
2. BFS 收集传递依赖
3. 复制到 `build/openclaw-plugins/{pluginId}/`
4. 修补插件 ID 不匹配问题（如 wecom）

---

### 3.4 Phase 4: 预装技能打包

**脚本**: [scripts/bundle-preinstalled-skills.mjs](../scripts/bundle-preinstalled-skills.mjs)

**配置文件**: `resources/skills/preinstalled-manifest.json`

**输出目录**: `build/preinstalled-skills/`

**处理流程**:
1. 读取技能清单
2. 使用 Git sparse checkout 从远程仓库获取指定目录
3. 复制到输出目录
4. 生成 `.preinstalled-lock.json` 锁定文件

**环境变量控制**:
```bash
SKIP_PREINSTALLED_SKILLS=1  # 跳过技能打包
```

---

### 3.5 Phase 5: 外部二进制文件下载

#### 3.5.1 uv 下载

**脚本**: [scripts/download-bundled-uv.mjs](../scripts/download-bundled-uv.mjs)

**版本**: uv 0.10.0

**下载目标**:
```
resources/bin/
├── win32-x64/
│   └── uv.exe
└── win32-arm64/
    └── uv.exe
```

**下载源**: `https://github.com/astral-sh/uv/releases/download/{version}/`

#### 3.5.2 Node.js 下载

**脚本**: [scripts/download-bundled-node.mjs](../scripts/download-bundled-node.mjs)

**版本**: Node.js 22.16.0

**下载目标**:
```
resources/bin/
├── win32-x64/
│   └── node.exe
└── win32-arm64/
    └── node.exe
```

**下载源**: `https://nodejs.org/dist/v{version}/`

---

### 3.6 Phase 6: electron-builder 打包

**配置文件**: [electron-builder.yml](../electron-builder.yml)

#### 3.6.1 Windows 特定配置

```yaml
win:
  verifyUpdateCodeSignature: false  # 跳过签名验证
  extraResources:
    - from: resources/bin/win32-${arch}
      to: bin
    - from: resources/cli/win32/
      to: cli/
  icon: resources/icons/icon.ico
  target:
    - target: nsis
      arch: x64
    - target: nsis
      arch: arm64
```

#### 3.6.2 NSIS 安装器配置

```yaml
nsis:
  oneClick: false                    # 非一键安装
  perMachine: false                  # 默认用户级安装
  allowToChangeInstallationDirectory: true  # 允许选择安装目录
  createDesktopShortcut: true
  createStartMenuShortcut: true
  differentialPackage: true          # 差分更新包
  include: scripts/installer.nsh     # 自定义脚本
```

#### 3.6.3 打包文件包含

```yaml
files:
  - dist              # 前端构建产物
  - dist-electron     # Electron 主进程代码
  - package.json

extraResources:
  - from: resources/
    to: resources/
  - from: build/openclaw/
    to: openclaw/
  - from: build/preinstalled-skills/
    to: resources/preinstalled-skills/
```

---

### 3.7 Phase 7: afterPack 钩子处理

**脚本**: [scripts/after-pack.cjs](../scripts/after-pack.cjs)

**触发时机**: electron-builder 完成打包后

**主要功能**:

#### 7.1 复制 node_modules
由于 `.gitignore` 排除了 `node_modules/`，electron-builder 的 extraResources 会跳过这些目录。afterPack 手动复制：

```
build/openclaw/node_modules/ -> resources/app.asar.unpacked/openclaw/node_modules/
```

#### 7.2 插件二次打包
如果 `build/openclaw-plugins/` 不存在，直接从 node_modules 打包插件到输出目录。

#### 7.3 清理无用文件
- 删除测试目录（test, tests, __tests__）
- 删除文档文件（README.md, CHANGELOG.md）
- 删除类型定义（.d.ts）
- 删除源码映射（.js.map）

#### 7.4 平台特定清理
保留目标平台的原生模块，删除其他平台：

```
koffi/build/koffi/
├── win32_x64/   <- 保留 (x64 构建)
├── win32_arm64/ <- 保留 (arm64 构建)
├── darwin_x64/  <- 删除
└── linux_x64/   <- 删除
```

类似处理：`@napi-rs/canvas-*`, `@img/sharp-*`, `@node-llama-cpp/*` 等

#### 7.5 修补损坏模块
- `node-domexception`: 修复 CJS 导出问题
- `https-proxy-agent`: 添加 CJS require 条件

---

### 3.8 Phase 8: NSIS 安装器定制

**脚本**: [scripts/installer.nsh](../scripts/installer.nsh)

#### 8.1 安装时操作

1. **启用 Windows 长路径支持**:
   ```nsis
   WriteRegDWORD HKLM "SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled" 1
   ```

2. **添加 CLI 到 PATH**:
   通过 PowerShell 脚本将 `resources\cli` 添加到用户 PATH

#### 8.2 卸载时操作

1. **从 PATH 移除 CLI 目录**
2. **询问删除用户数据**:
   - `%USERPROFILE%\.openclaw`
   - `%LOCALAPPDATA%\stoclaw`
   - `%APPDATA%\stoclaw`

3. **处理所有用户数据**（如果是全局安装）

---

## 4. 输出产物

### 4.1 目录结构

```
release/
├── StoClaw-{version}-win-x64.exe        # x64 安装器
├── StoClaw-{version}-win-x64.exe.blockmap
├── StoClaw-{version}-win-arm64.exe      # arm64 安装器
├── StoClaw-{version}-win-arm64.exe.blockmap
├── win-unpacked/                       # x64 解压版
│   ├── StoClaw.exe
│   └── resources/
│       ├── app.asar
│       ├── app.asar.unpacked/
│       ├── bin/
│       │   ├── uv.exe
│       │   └── node.exe
│       ├── cli/
│       ├── openclaw/
│       │   └── node_modules/
│       ├── openclaw-plugins/
│       │   ├── dingtalk/
│       │   ├── wecom/
│       │   └── ...
│       └── resources/
│           └── preinstalled-skills/
└── win-arm64-unpacked/                 # arm64 解压版
```

### 4.2 ASAR 打包

```
app.asar/
├── dist/               # 前端资源
├── dist-electron/      # Electron 主进程
└── package.json
```

**排除 ASAR 打包的文件**:
```yaml
asarUnpack:
  - "**/*.node"  # 原生模块
```

---

## 5. 自动更新配置

```yaml
publish:
  - provider: generic
    url: https://ali-sto-wisdom-star.aliyuncs.com/latest
  - provider: github
    owner: ValueCell-ai
    repo: StoClaw
```

**更新流程**:
1. 主源: 阿里云 OSS（国内用户优先）
2. 备用源: GitHub Releases

---

## 6. 打包前置条件

### 6.1 环境要求

- Node.js 18.x+
- pnpm 10.31.0 (通过 corepack 激活)
- Git

### 6.2 初始化步骤

```bash
# 激活 pnpm 版本
corepack enable
corepack prepare

# 安装依赖 + 下载 uv
pnpm run init
```

---

## 7. 常见问题与注意事项

### 7.1 Windows 长路径问题

pnpm 虚拟存储路径可能超过 260 字符限制。解决方案：
1. 安装器自动启用注册表 `LongPathsEnabled`
2. 脚本中使用 `\\?\` 前缀处理路径

### 7.2 原生模块 ABI 兼容性

- `@discordjs/opus` 跳过打包（Electron ABI 不兼容）
- 运行时原生模块由 bundled Node.js 运行

### 7.3 构建脚本竞争条件

`pnpm run lint` 可能在 `uv:download` 执行期间失败，重新运行即可。

### 7.4 可选依赖警告

`@discordjs/opus` 和 `koffi` 的构建脚本警告可安全忽略。

---

## 8. CI/CD 流程建议

```yaml
# 示例 GitHub Actions 流程
jobs:
  build-win:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      
      - name: Enable pnpm
        run: corepack enable
      
      - name: Install dependencies
        run: pnpm run init
      
      - name: Build Windows
        run: pnpm run package:win
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          path: release/*.exe
```

---

## 9. 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      打包流程总览                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │ Vite     │───▶│ dist/        │    │                 │   │
│  │ Build    │    │ dist-electron│───▶│  electron-      │   │
│  └──────────┘    └──────────────┘    │  builder        │   │
│                                      │                 │   │
│  ┌──────────┐    ┌──────────────┐    │   ┌─────────┐   │   │
│  │ Bundle   │───▶│ build/       │───▶│   │ afterPack│───┼──▶ release/
│  │ OpenClaw │    │ openclaw/    │    │   │ hook     │   │   │
│  └──────────┘    └──────────────┘    │   └─────────┘   │   │
│                                      │                 │   │
│  ┌──────────┐    ┌──────────────┐    │   ┌─────────┐   │   │
│  │ Bundle   │───▶│ build/       │───▶│   │ NSIS    │   │   │
│  │ Plugins │    │ openclaw-    │    │   │ Install │   │   │
│  └──────────┘    │ plugins/     │    │   └─────────┘   │   │
│                  └──────────────┘    │                 │   │
│  ┌──────────┐    ┌──────────────┐    │                 │   │
│  │ Download │───▶│ resources/   │───▶│                 │   │
│  │ Binaries │    │ bin/         │    │                 │   │
│  └──────────┘    └──────────────┘    └─────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. 参考文件索引

| 文件路径 | 用途 |
|----------|------|
| [package.json](../package.json) | 打包命令定义 |
| [electron-builder.yml](../electron-builder.yml) | electron-builder 配置 |
| [vite.config.ts](../vite.config.ts) | Vite 构建配置 |
| [scripts/bundle-openclaw.mjs](../scripts/bundle-openclaw.mjs) | OpenClaw 打包脚本 |
| [scripts/bundle-openclaw-plugins.mjs](../scripts/bundle-openclaw-plugins.mjs) | 插件打包脚本 |
| [scripts/bundle-preinstalled-skills.mjs](../scripts/bundle-preinstalled-skills.mjs) | 技能打包脚本 |
| [scripts/download-bundled-uv.mjs](../scripts/download-bundled-uv.mjs) | uv 下载脚本 |
| [scripts/download-bundled-node.mjs](../scripts/download-bundled-node.mjs) | Node.js 下载脚本 |
| [scripts/after-pack.cjs](../scripts/after-pack.cjs) | 打包后处理钩子 |
| [scripts/installer.nsh](../scripts/installer.nsh) | NSIS 自定义脚本 |
