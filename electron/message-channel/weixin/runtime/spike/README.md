# Weixin spike

本地联调脚本（见 `docs/微信渠道-Host-Worker技术方案.md`）。

## Run

Smoke（短观察窗口）:

```bash
SPIKE_MIN_OBSERVE_MS=0 SPIKE_MIN_ROUNDS=5 SPIKE_LONG_POLL_MS=8000 \
  npx tsx electron/message-channel/weixin/runtime/spike/phase0-r1-r4.ts
```

完整观察（≥5 次成功 `getUpdates`，观察 ≥10 分钟）:

```bash
npx tsx electron/message-channel/weixin/runtime/spike/phase0-r1-r4.ts
```

可选单次 `sendMessage`:

```bash
SPIKE_SEND=1 SPIKE_MIN_OBSERVE_MS=0 SPIKE_MIN_ROUNDS=2 \
  npx tsx electron/message-channel/weixin/runtime/spike/phase0-r1-r4.ts
```

## 约束

仅通过 `transport/client-v1` 使用 vendor `api`（及本地 shim），不要从 spike 直接拉取 plugin 入口相关模块。

产出：`phase0-report.json`。
