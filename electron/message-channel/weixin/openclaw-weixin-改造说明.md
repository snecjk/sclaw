# openclaw-weixin 改造说明

上游：`@tencent-weixin/openclaw-weixin` 源码快照 → `runtime/vendor/openclaw-weixin-main/`（MIT）。  
**不作为** OpenClaw Gateway 渠道插件加载；实际跑在 Host `utilityProcess` Worker。  
当前快照版本见 [`README.VENDOR.md`](runtime/vendor/openclaw-weixin-main/README.VENDOR.md)。

## 做了什么

1. **运行时形态**  
   自研 `runtime/worker-entry` + `transport/` + `adapter/` 编排收发；只复用 vendor 的 **薄传输**（`api` / CDN / mime 等），不走 `channel.ts` / `process-message` / plugin 生命周期。

2. **剥离 plugin-sdk 值导入**（薄路径）  
   本地 shim 替代运行时依赖：
   - `src/shims/infra-runtime.ts` — tmp 目录、文件锁  
   - `src/shims/account-id.ts` — accountId 归一  
   详情见 [`README.VENDOR.md`](runtime/vendor/openclaw-weixin-main/README.VENDOR.md)。

3. **状态目录**  
   凭证与运行态落 `~/.stoclaw/weixin/`；启动时可从旧路径 `~/.stoclaw/openclaw/openclaw-weixin/` 拷贝（不删源）。

4. **出站语义**  
   Host ↔ Worker 以 typing + 终态 commit（+ cancel）为主，不把引擎全文 delta 刷成多条微信消息。

5. **产品边界**  
   单 Bot；扫码 / 绑定 / 引擎选择在 Host（`weixin/` 根目录），不进 vendor。

## 刻意未改 / 未用

- vendor 内插件入口、配对、Gateway config reload 等仍留在树中作对照，**不在 Worker 引用图内**。
- 不 `npm install` / 不注册 `openclaw.plugin.json`。

## 上游升级怎么做

我们吃的是 **源码快照**，不是根 `package.json` 里的 npm 依赖。升级 = 换 vendor 目录 + 重打我们的补丁。

### 1. 取上游

- 从发布 tag / npm 包 / 官方仓库拿到目标版本源码（记下 version）。
- 建议先把当前 `runtime/vendor/openclaw-weixin-main/` 整目录备份或开单独分支。

### 2. 覆盖快照

- 用新版本内容替换 `runtime/vendor/openclaw-weixin-main/`（保留我们的 `README.VENDOR.md`，或覆盖后按下面第 4 步重写）。
- **不要**改成「运行时 `require('@tencent-weixin/openclaw-weixin')`」；继续用树内源码。

### 3. 重打 StoClaw 补丁（必做）

对照旧版 `README.VENDOR.md` 补丁表，在新树里重新改：

| 关注文件 | 动作 |
| --- | --- |
| `src/util/logger.ts` 等 | 薄路径上凡是 `openclaw/plugin-sdk` **值导入**，改回本地 `src/shims/*` |
| `src/shims/` | 若上游改了 API，同步改 shim；缺函数就补 |
| `transport/client-v1.ts`、`adapter/*` | 核对仍能 `import` 到的 `api` / CDN / mime 路径；上游改名或拆文件时改我们的 re-export |

grep 检查（应只剩 type-only 或未引用路径上的 plugin-sdk）：

```bash
rg "from ['\"]openclaw/plugin-sdk" electron/message-channel/weixin/runtime/vendor/openclaw-weixin-main/src
```

Worker / spike **不得**新增对 `channel.ts`、`process-message`、`outbound-hooks`、`pairing` 的引用。

### 4. 更新元数据

- 更新 `README.VENDOR.md` 的 Snapshot version 与补丁表。
- 若上游 `ilink_appid` / 协议字段有变，检查 Host 扫码与 `vite` 侧合成 `package.json` 是否仍匹配。

### 5. 验证

1. Spike smoke（短窗口即可）：见 [`runtime/spike/README.md`](runtime/spike/README.md)  
2. 真机：扫码绑定 → 收一条 → 回一条（含可选图片）  
3. 确认列表合并与解绑仍只走 Host binding，未拉起 OC 微信插件  

### 注意

- 协议/字段 breaking 时，优先改 `transport/` + `adapter/`，少在 vendor 里堆业务。
- 长期目标仍是稳定逻辑迁出 vendor；升级频率越高，越应缩小对 vendor 路径的硬依赖面。
