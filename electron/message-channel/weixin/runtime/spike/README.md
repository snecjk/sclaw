# Phase 0 Spike

Feasibility gate for Weixin Host-Worker (see `docs/微信渠道-Host-Worker技术方案.md` §8).

## Run

Smoke (fast; does **not** meet R4 10-minute window):

```bash
SPIKE_MIN_OBSERVE_MS=0 SPIKE_MIN_ROUNDS=5 SPIKE_LONG_POLL_MS=8000 \
  npx tsx electron/message-channel/weixin/runtime/spike/phase0-r1-r4.ts
```

Full R4 (≥5 successful `getUpdates`, observe ≥10 minutes):

```bash
npx tsx electron/message-channel/weixin/runtime/spike/phase0-r1-r4.ts
```

Optional one-shot `sendMessage` (uses migrated context token):

```bash
SPIKE_SEND=1 SPIKE_MIN_OBSERVE_MS=0 SPIKE_MIN_ROUNDS=2 \
  npx tsx electron/message-channel/weixin/runtime/spike/phase0-r1-r4.ts
```

## Thin-path constraint

Spike must **not** import `process-message` / `outbound-hooks` / `pairing` consumers / `channel.ts` plugin entry.
Only `transport/client-v1` → vendor `api` (+ local shims for former plugin-sdk value imports).

## Report

Writes `phase0-report.json` next to this README.
