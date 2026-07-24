# 申通龙虾电子宠物实现计划（Phase 1 详案 + 后续分期）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。
>
> **规格：** `sto-claw/docs/superpowers/specs/2026-07-13-sto-lobster-pet-design.md`  
> **执行顺序：** 先完成任务 1–7（Phase 1），再按任务 8–12 做后续能力；Schema/模块在 Phase 1 就要预留扩展点。

**Phase 1 目标：** 可 mute 的申通龙虾：四档定时预生成、多 Zone 选位、两段式冒泡、兜底、快捷回复、idle、主 Agent 不冒充龙虾、Bones/Soul 身份。

**后续目标（已定案，必须进本计划）：** 心情改人格、对话任务推荐、自由像素位移、FloatIcon/Sprite 联动、回合旁观 Reactor（吸收 Claude Buddy）。

**架构：** `src/pet/*` + Host API；`scheduler` / `director` / `reactor`(后期) / `PetStage`；Zone 锚点 +（后期）安全矩形位移；桌面窗共享 Identity/Store。

**技术栈：** React + Zustand + Vitest；Electron Host API；复用 `logo.png` / 桌面 `FloatIcon`/`Sprite`。

**仓库根目录：** `sto-claw/`

---

## 0. 产品决策清单（含后加需求 + Claude Buddy 吸收）

### 0.1 对话中后加、必须落地的能力

| 决策 | 来源 | 落入 |
|------|------|------|
| 可点短互动 + **超时自动展开**全文 | 用户 | Phase 1 任务 6 |
| 模型**提前**生成；失败**本地兜底** | 用户 | Phase 1 任务 1/4 |
| **大区域**由客户端圈定，AI 选 zone + motion + 话术 | 用户 | Phase 1 任务 2/4/6 |
| 四档：9:00 拉拉队长 / 12:00 毛毛虫 / 18:00 下班 / 21:00+ 亲听者 | 用户 | Phase 1 任务 1/5 |
| **心情检测改人格** | 用户后加 | 任务 8（Phase 2a） |
| **根据对话做任务推荐** | 用户后加 | 任务 9（Phase 2b） |
| **自由像素位移** | 用户后加 | 任务 11（Phase 3） |
| **FloatIcon / Sprite 联动** | 用户后加 | 任务 12（Phase 4） |
| Schema 预留 `moodHint` / `recommendations` / `position` | 规格 | **Phase 1 任务 1/2 就必须写进类型**，即使暂不消费 |

### 0.2 从 Claude Code Buddy 吸收（对照 `openproject/claude-code/src/buddy`）

| Buddy 优点 | 本产品怎么用 | 任务 |
|------------|--------------|------|
| 宠物 ≠ 主助手（`prompt.ts` watcher） | `main-agent-bridge` + 主模型少抢话 | 任务 6（Phase 1） |
| Bones 每次重算 + Soul 一次持久 | `identity.ts`：轻量 variant + 昵称/口头禅；**不做稀有度 gacha** | 任务 3、4 hatch |
| 渲染 tick 与内容解耦（`CompanionSprite` 500ms） | `PetStage` idle 动画 ⊥ Director/Reactor 推送 | 任务 6；任务 10 复用气泡通道 |
| 限频旁观 + 叫名字加速（`companionReact` ~45s） | `reactor.ts` 回合后短评 | 任务 10（Phase 2c） |
| mute / 显隐 | `muted` / `hidden` + 设置或右键 | 任务 3、7 |
| 气泡自动淡出 | greeting/body 展示寿命 | 任务 6 |
| **不抄：** 抽卡稀有度、ASCII 单点、纯回合无定时 | — | 全程禁止 |

### 0.3 Phase 与任务总表

```text
Phase 1  任务 1–7   定时舞台 + 身份 + 隔离 + mute     ← 先做
Phase 2a 任务 8     心情检测改人格
Phase 2b 任务 9     对话任务推荐
Phase 2c 任务 10    Reactor 回合旁观（Buddy 旁路）
Phase 3  任务 11    自由像素位移
Phase 4  任务 12    FloatIcon / Sprite 联动
```

---

## 文件结构（锁定边界）

### Phase 1 必建

| 文件 | 职责 |
|------|------|
| `src/pet/types.ts` | Script/slot/persona/zone/motion；**含预留** `moodHint?` / `recommendations?` / `position?` |
| `src/pet/slots.ts` | 四档窗口、`getActiveSlot`、`localDateKey` |
| `src/pet/fallback.ts` | 各档兜底 Script |
| `src/pet/script-schema.ts` | 校验裁剪；未知预留字段可透传或忽略 |
| `src/pet/identity.ts` | Bones + Soul（吸收 Buddy，无 gacha） |
| `src/pet/store.ts` | Cache、消费、mute/hidden、演出态 |
| `src/pet/director.ts` | 定时预生成 |
| `src/pet/scheduler.ts` | 窗口 / 频控 / 忙时延后 |
| `src/pet/zones.tsx` | Zone 锚点 |
| `src/pet/PetBubble.tsx` | 两段式气泡 |
| `src/pet/PetStage.tsx` | idle + 定位 + 演出 |
| `src/pet/main-agent-bridge.ts` | 主 Agent 隔离 intro（吸收 Buddy） |
| `src/pet/use-pet-bootstrap.ts` | 启动 scheduler + hatch |
| `electron/api/routes/pet.ts` | `scene-script` / `hatch-soul` |
| `MainLayout` / `HomeComposer` / `HomeMainConversation` | 挂载与锚点 |
| `tests/unit/pet-*.test.ts` | 单测 |

### 后续阶段增建（先占位，防返工）

| 文件 | 阶段 | 职责 |
|------|------|------|
| `src/pet/mood.ts` | 2a | 轻量心情启发式 / 摘要 → `moodHint` |
| `src/pet/recommendations.ts` | 2b | 推荐条目校验与注入 Composer |
| `src/pet/reactor.ts` | 2c | 回合后短评、45s 限频、点名加速 |
| `src/pet/motion-path.ts` | 3 | 安全矩形内 `position` 插值 |
| `src/pet/desktop-sync.ts` | 4 | 与 FloatIcon/Sprite 共享状态 IPC |

---

### 任务 1：类型、时段表与兜底文案

**文件：**
- 创建：`src/pet/types.ts`
- 创建：`src/pet/slots.ts`
- 创建：`src/pet/fallback.ts`
- 测试：`tests/unit/pet-slots.test.ts`

- [ ] **步骤 1：编写失败的时段测试**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveSlot, localDateKey } from '../../src/pet/slots';

describe('pet slots', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects morning_start in window', () => {
    vi.setSystemTime(new Date(2026, 6, 13, 9, 5, 0));
    expect(getActiveSlot(new Date()).slotId).toBe('morning_start');
  });

  it('returns null outside windows before late_night', () => {
    vi.setSystemTime(new Date(2026, 6, 13, 15, 0, 0));
    expect(getActiveSlot(new Date())).toBeNull();
  });

  it('detects late_night after 21:00', () => {
    vi.setSystemTime(new Date(2026, 6, 13, 21, 30, 0));
    expect(getActiveSlot(new Date())?.slotId).toBe('late_night');
  });

  it('localDateKey is stable YYYY-MM-DD in local tz', () => {
    vi.setSystemTime(new Date(2026, 6, 13, 23, 0, 0));
    expect(localDateKey(new Date())).toBe('2026-07-13');
  });
});
```

- [ ] **步骤 2：运行确认失败**

```bash
cd sto-claw && pnpm exec vitest run tests/unit/pet-slots.test.ts
```

预期：FAIL（模块不存在）

- [ ] **步骤 3：实现 `types.ts` / `slots.ts` / `fallback.ts`**

`types.ts` 按规格 §7.1 定义 `PetSlotId`、`PetPersona`、`PetZoneId`、`PetMotion`、`PetSceneScript`、`PetPresentPhase = 'idle' | 'greeting' | 'expanded'`。  
**必须同时声明预留字段（Phase 1 可不消费）：** `moodHint?`、`recommendations?`、`position?`——对应后加的心情/推荐/自由位移，避免后续改类型大面积返工。

`slots.ts`：

```ts
export const PET_SLOTS = [
  { slotId: 'morning_start', persona: 'cheer_captain', startHour: 9, startMin: 0, endHour: 9, endMin: 20 },
  { slotId: 'lunch', persona: 'lazy_caterpillar', startHour: 12, startMin: 0, endHour: 12, endMin: 30 },
  { slotId: 'offwork', persona: 'offwork_nudge', startHour: 18, startMin: 0, endHour: 18, endMin: 30 },
  { slotId: 'late_night', persona: 'empathic_listener', startHour: 21, startMin: 0, endHour: 23, endMin: 59 },
] as const;

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getActiveSlot(now: Date): (typeof PET_SLOTS)[number] | null {
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const s of PET_SLOTS) {
    const a = s.startHour * 60 + s.startMin;
    const b = s.endHour * 60 + s.endMin;
    if (mins >= a && mins <= b) return s;
  }
  return null;
}
```

`fallback.ts`：为四档各写一份完整 `PetSceneScript`（greeting≤20、body≤80、replies 1–3、waitMs=8000、zone/motion 按规格兜底表）。导出 `getFallbackScript(slotId, dateKey, soulName?)`。

- [ ] **步骤 4：跑测试确认通过**

```bash
pnpm exec vitest run tests/unit/pet-slots.test.ts
```

预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/pet/types.ts src/pet/slots.ts src/pet/fallback.ts tests/unit/pet-slots.test.ts
git commit -m "$(cat <<'EOF'
feat(pet): add slot windows, types, and fallback scripts

EOF
)"
```

---

### 任务 2：Script Schema 校验

**文件：**
- 创建：`src/pet/script-schema.ts`
- 测试：`tests/unit/pet-script-schema.test.ts`

- [ ] **步骤 1：写失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { parsePetSceneScript } from '../../src/pet/script-schema';

describe('parsePetSceneScript', () => {
  it('accepts valid payload and clamps lengths', () => {
    const s = parsePetSceneScript({
      slotId: 'morning_start',
      persona: 'cheer_captain',
      zone: 'zone_composer',
      motion: 'peek',
      greeting: '早上好，我的小主人！！！！！！！！！！！！',
      body: 'x'.repeat(200),
      replies: ['出发', '再睡一会', '太长的回复会被裁掉的对吧真的吗'],
      waitMs: 8000,
      expiresAt: Date.now() + 3600_000,
    });
    expect(s).not.toBeNull();
    expect(s!.greeting.length).toBeLessThanOrEqual(20);
    expect(s!.body.length).toBeLessThanOrEqual(80);
    expect(s!.replies.every((r) => r.length <= 12)).toBe(true);
  });

  it('rejects unknown zone', () => {
    expect(
      parsePetSceneScript({
        slotId: 'lunch',
        persona: 'lazy_caterpillar',
        zone: 'zone_moon',
        motion: 'crawl',
        greeting: '饿了',
        body: '吃饭去',
        replies: ['走'],
        waitMs: 8000,
        expiresAt: Date.now() + 1,
      }),
    ).toBeNull();
  });
});
```

- [ ] **步骤 2：跑测确认失败 → 实现 `parsePetSceneScript` → 再跑 PASS → Commit**

实现要点：枚举白名单；缺字段返回 null；字符串 trim + 截断；`replies` 取 1–3 条；`waitMs` 默认 8000，夹在 3000–20000。  
预留字段：若存在合法 `moodHint` / `recommendations` / `position` 则保留在对象上（Phase 1 UI 可忽略），非法则剥离，不要整份 Script 判失败。

```bash
git add src/pet/script-schema.ts tests/unit/pet-script-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(pet): validate and clamp scene script JSON

EOF
)"
```

---

### 任务 3：Identity（Bones + Soul）与 Store

**文件：**
- 创建：`src/pet/identity.ts`
- 创建：`src/pet/store.ts`
- 测试：`tests/unit/pet-identity-store.test.ts`（可用 vitest + 重置 persist）

- [ ] **步骤 1：实现 identity**

```ts
// identity.ts — 要点
export type PetSoul = { name: string; catchphrase: string; hatchedAt: number };
export type PetBones = { variant: 0 | 1 | 2 }; // 轻量配色变体，不做稀有度

export function rollBones(userId: string): PetBones {
  let h = 2166136261;
  const s = `${userId}|sto-lobster-2026`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return { variant: (h >>> 0) % 3 as 0 | 1 | 2 };
}

export function defaultSoul(): PetSoul {
  return { name: '小钳钳', catchphrase: '夹住今天的好运', hatchedAt: Date.now() };
}
```

`userId` 优先 `useAuthStore` 里稳定字段；没有则 `'anon'`。

- [ ] **步骤 2：实现 zustand `usePetStore`**

状态字段最少包含：
- `soul: PetSoul | null`
- `muted: boolean` / `hidden: boolean`
- `scriptCache: Record<string, PetSceneScript>` // key = `${slotId}:${dateKey}`
- `consumed: Record<string, true>` // 同 key
- `activeScript: PetSceneScript | null`
- `phase: PetPresentPhase`
- actions：`setSoul`、`setMuted`、`setHidden`、`putScript`、`markConsumed`、`beginPresent`、`setPhase`、`clearPresent`

使用 `persist`，name：`sto-claw-pet-v1`。

- [ ] **步骤 3：单测 cache key 消费与 mute 不影响写入**

- [ ] **步骤 4：Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pet): add identity bones/soul and persisted pet store

EOF
)"
```

---

### 任务 4：Director（Host API + 兜底）

**文件：**
- 创建：`src/pet/director.ts`
- 创建：`electron/api/routes/pet.ts`
- 修改：`electron/api/server.ts`（或现有路由分发文件，搜索 `routes/settings` 注册方式并同样挂上）
- 测试：`tests/unit/pet-fallback-director.test.ts`

- [ ] **步骤 1：写 Director 单测（mock hostApiFetch）**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

import { hostApiFetch } from '@/lib/host-api';
import { prefetchSlotScript } from '../../src/pet/director';

describe('prefetchSlotScript', () => {
  beforeEach(() => {
    vi.mocked(hostApiFetch).mockReset();
  });

  it('uses LLM payload when valid', async () => {
    vi.mocked(hostApiFetch).mockResolvedValue({
      slotId: 'morning_start',
      persona: 'cheer_captain',
      zone: 'zone_composer',
      motion: 'peek',
      greeting: '早上好，小主人',
      body: '新的一天，我们一起搞定最难的那件事先。',
      replies: ['出发', '先喝咖啡'],
      waitMs: 8000,
      expiresAt: Date.now() + 600_000,
    });
    const script = await prefetchSlotScript({
      slotId: 'morning_start',
      dateKey: '2026-07-13',
      soulName: '小钳钳',
      context: { surface: 'home', busy: false },
    });
    expect(script.greeting).toContain('早上');
  });

  it('falls back when API throws', async () => {
    vi.mocked(hostApiFetch).mockRejectedValue(new Error('network'));
    const script = await prefetchSlotScript({
      slotId: 'lunch',
      dateKey: '2026-07-13',
      soulName: '小钳钳',
      context: { surface: 'home', busy: false },
    });
    expect(script.slotId).toBe('lunch');
    expect(script.greeting.length).toBeGreaterThan(0);
  });
});
```

- [ ] **步骤 2：实现 `director.ts`**

- `hostApiFetch('/api/pet/scene-script', { method: 'POST', body: JSON.stringify({...}) })`
- 超时：`AbortSignal.timeout(8000)`（若环境不支持则 Promise.race）
- `parsePetSceneScript` 失败 → `getFallbackScript`
- 成功后 `usePetStore.getState().putScript(key, script)`

- [ ] **步骤 3：实现 Electron 路由**

`POST /api/pet/scene-script`：
1. 读 body：`slotId`、`persona`、`soulName`、轻量 `context`
2. 用当前默认 Provider 发 **单次** chat/completions 或 anthropic messages（复用 `electron/services/providers` 里已有 baseUrl/apiKey 读取方式；参考 `provider-validation.ts` 的请求头拼法）
3. System prompt 要求 **只输出 JSON**，字段与 `PetSceneScript` 一致；枚举写死在 prompt
4. 解析失败返回 502；路由层也可直接返回 fallback JSON（二选一，推荐 200+fallback 以免前端分支爆炸）

`POST /api/pet/hatch-soul`：生成 `{ name, catchphrase }`，失败返回默认「小钳钳」。

若 Phase 1 接线 Provider 过重：路由 **先直接返回 `getFallbackScript` 等价 JSON**，并在文件头注释 `TODO(llm)`；但 `director` 调用链与测试必须保留——下一提交再填真 LLM。**优先在本任务内接上真 LLM**；实在堵在 Provider 上再降级，并在 PR 说明。

- [ ] **步骤 4：跑测 PASS → Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pet): prefetch scene scripts via host API with fallback

EOF
)"
```

---

### 任务 5：Scheduler（窗口、频控、忙时延后）

**文件：**
- 创建：`src/pet/scheduler.ts`
- 测试：`tests/unit/pet-scheduler.test.ts`

- [ ] **步骤 1：写测试**

覆盖：
1. 进入窗口且未消费 → 调用 `onPresent(script)`
2. 已消费 → 不 present
3. `busy=true` → 不 present，标记 pending；`busy` 变 false 后 present
4. 窗口开始前 5–10 分钟逻辑：用注入的 `now` 测「距窗口开始 ≤10min」触发 `onPrefetch`

把时间与副作用做成纯函数 + 回调，便于测：

```ts
export type SchedulerDeps = {
  now: () => Date;
  isBusy: () => boolean;
  isMutedOrHidden: () => boolean;
  getConsumed: (key: string) => boolean;
  getCached: (key: string) => PetSceneScript | undefined;
  prefetch: (slotId: PetSlotId, dateKey: string) => Promise<void>;
  present: (script: PetSceneScript) => void;
};

export function tickPetScheduler(deps: SchedulerDeps): void { /* ... */ }
```

- [ ] **步骤 2：实现 `tickPetScheduler` + `startPetScheduler`（`setInterval` 30s）**

规则对齐规格：每档每天一次；mute/hidden 时不 present（仍可 prefetch）；busy 延后。

- [ ] **步骤 3：PASS → Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pet): schedule timed slots with busy defer and daily cap

EOF
)"
```

---

### 任务 6：Zone 锚点 + PetStage 两段式 UI

**文件：**
- 创建：`src/pet/zones.tsx`
- 创建：`src/pet/PetBubble.tsx`
- 创建：`src/pet/PetStage.tsx`
- 创建：`src/pet/use-pet-bootstrap.ts`
- 创建：`src/pet/main-agent-bridge.ts`
- 修改：`src/styles/globals.css`（增加 `.pet-mascot-idle`）
- 修改：`src/components/layout/MainLayout.tsx`
- 修改：`src/pages/Home/HomeComposer.tsx`
- 修改：`src/pages/Home/HomeMainConversation.tsx`（左右留白容器加 `PetZoneAnchor`；若布局无独立留白列，先只挂 composer，chat zones 返回 unavailable）

- [ ] **步骤 1：`PetZoneAnchor`**

```tsx
// zones.tsx
export function PetZoneAnchor({ id, children, className }: { id: PetZoneId; children?: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { register, unregister } = usePetZones();
  useEffect(() => {
    register(id, ref);
    return () => unregister(id);
  }, [id, register, unregister]);
  return (
    <div ref={ref} className={className} data-pet-zone={id}>
      {children}
    </div>
  );
}
```

`HomeComposer` 外层包 `PetZoneAnchor id="zone_composer"`（注意不要破坏现有布局宽度）。

- [ ] **步骤 2：`PetStage` 行为**

- 读 `activeScript` + `phase`
- `phase==='greeting'`：显示公仔（`logo.png`）+ greeting；点击 → `expanded`；`waitMs` 到自动 `expanded`
- `expanded`：body + replies；点 reply → 调用传入的 `onReply(text)`（由 bootstrap 接到 `useHomeChatEntrySend` / chat send）；然后 `markConsumed` + `clearPresent`
- `hidden || muted`：return null
- 定位：`getBoundingClientRect` of zone ref，`position: fixed` 把公仔放到锚点上方/侧方；zone 缺失则 `zone_composer` 回退；再缺失则右下安全位置
- idle：无 activeScript 时可选弱 idle（规格允许弱可关）；Phase 1 建议 **仅在有 present 或 settings 允许常驻时显示小公仔**，避免一直挡 UI——默认 **仅演出时出现**，idle 动画在出场后播放

- [ ] **步骤 3：`use-pet-bootstrap.ts`**

在 `MainLayout` 内调用：init soul（无则 default 或 hatch API）、`startPetScheduler`、订阅 `useChatStore` 的 `sending`/`streamingMessage` 作为 busy。

- [ ] **步骤 4：`main-agent-bridge.ts`**

```ts
export function getPetIntroText(): string | null {
  const soul = usePetStore.getState().soul;
  if (!soul || usePetStore.getState().muted) return null;
  return `A small STO lobster pet named ${soul.name} may appear beside the UI. You are not ${soul.name}. If the user addresses ${soul.name}, keep your reply to one line or less and do not narrate the pet.`;
}
```

Phase 1：导出函数即可；若主发送链路有 system/context 拼接点，插入一行（搜索 `systemPrompt` / `extraSystem` / attachments）。**找不到安全插入点则先导出 + 在规格验收里记「bridge ready」**，不强行改聊天核心。

- [ ] **步骤 5：手测清单（开发者）**

1. 把系统时间或加 `window.__PET_DEBUG_SLOT__ = 'morning_start'` 调试钩子强制 present  
2. 见 greeting → 等 8s 自动 body  
3. 点快捷回复进输入框/发送  
4. mute 后不再出现  

- [ ] **步骤 6：Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pet): mount PetStage with zones and two-phase bubbles

EOF
)"
```

---

### 任务 7：Mute 开关与打磨

**文件：**
- 修改：设置页某一 General 区块（搜索 `telemetryEnabled` 开关旁增加「龙虾伴侣」：隐藏 / 静音气泡）
- 或临时：`PetStage` 右键菜单 Mute（若改设置页成本高，Phase 1 用右键/长按）

- [ ] **步骤 1：接上 `setMuted` / `setHidden` UI**
- [ ] **步骤 2：确保消费态跨重启仍有效（persist）**
- [ ] **步骤 3：`pnpm exec vitest run tests/unit/pet-*.test.ts` 全绿**
- [ ] **步骤 4：Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(pet): add mute/hide controls for lobster companion

EOF
)"
```

---

## Phase 2+ 任务（后加需求 + Buddy Reactor，Phase 1 完成后执行）

### 任务 8：心情检测改人格（Phase 2a）

**文件：** 创建 `src/pet/mood.ts`；修改 `director.ts`（prefetch 带 mood）；修改 `script-schema.ts` 消费 `moodHint`；可选覆盖同档默认 `persona`。

- [ ] **步骤 1：** 用近几轮摘要或本地启发式（深夜+仍在发送 → tired/stressed）产出 `moodHint`
- [ ] **步骤 2：** Director prompt 要求可按 mood 调整 persona/语气；非法 persona 回退档位默认
- [ ] **步骤 3：** 单测：stressed → empathic 倾向；无信号不改档
- [ ] **步骤 4：** Commit `feat(pet): mood hint can override slot persona`

### 任务 9：对话任务推荐（Phase 2b）

**文件：** 创建 `src/pet/recommendations.ts`；`PetBubble` expanded 区展示推荐；点击注入 Composer。

- [ ] **步骤 1：** Schema 校验 `recommendations: { title, prompt }[]`（最多 3 条）
- [ ] **步骤 2：** Director/专用 API 基于对话摘要生成推荐（与主 Agent 能力对齐，不另起任务引擎）
- [ ] **步骤 3：** UI：展开态在 replies 下方展示推荐芯片；点击 → `onReply(prompt)` 或只填入不发送
- [ ] **步骤 4：** Commit `feat(pet): conversation-aware task recommendations`

### 任务 10：Reactor 回合旁观（Phase 2c，吸收 Buddy companionReact）

**文件：** 创建 `src/pet/reactor.ts`；修改 `use-pet-bootstrap.ts` 在回合结束调用；复用 `PetStage` 气泡通道。

- [ ] **步骤 1：** 实现限频（默认 ≥45s）；检测输入/最近用户消息是否包含 Soul `name` → 可立即 react
- [ ] **步骤 2：** `POST /api/pet/react` 短气泡 ≤40 字；失败静默
- [ ] **步骤 3：** 若定时两段式未结束，**丢弃**本次 react（定时优先）
- [ ] **步骤 4：** 单测限频与点名加速；Commit `feat(pet): rate-limited turn reactor like buddy`

### 任务 11：自由像素位移（Phase 3）

**文件：** 创建 `src/pet/motion-path.ts`；修改 `PetStage` 消费 `position`；安全矩形避开侧栏/标题栏/发送按钮。

- [ ] **步骤 1：** 定义 `getPetSafeRect()`（viewport − chrome insets）
- [ ] **步骤 2：** Script.`position` 夹紧到安全矩形；Zone 仍作默认锚，位移为增强
- [ ] **步骤 3：** 短路径动画（≤600ms），不穿越侧栏
- [ ] **步骤 4：** Commit `feat(pet): free pixel motion within safe rect`

### 任务 12：FloatIcon / Sprite 联动（Phase 4）

**文件：** 创建 `src/pet/desktop-sync.ts`；修改 `src/pages/FloatIcon/index.tsx`、`src/pages/Sprite/index.tsx`。

- [ ] **步骤 1：** 共享 Identity + mute + 今日消费（IPC 或共用 persist key）
- [ ] **步骤 2：** 主窗口收起时 FloatIcon 可显示轻量表情/短 greeting；与主窗口 **互斥冒泡**（同一时间只一处说话）
- [ ] **步骤 3：** Sprite 复用同一 Director Cache，禁止第二套脑
- [ ] **步骤 4：** Commit `feat(pet): sync lobster state with FloatIcon and Sprite`

---

## 规格覆盖自检

### Phase 1（任务 1–7）

| 规格项 | 任务 |
|--------|------|
| 四档定时 | 1, 5 |
| 多 Zone + 模型选 zone/motion | 2, 4；失败兜底 |
| 预生成 + 到点不等等 | 4, 5 |
| 两段式 + 超时自动展开 | 6 |
| 本地兜底 | 1, 4 |
| 快捷回复进 Composer | 6 |
| idle ⊥ 内容（Buddy） | 6 |
| mute（Buddy） | 3, 7 |
| Bones/Soul 身份（Buddy，无 gacha） | 3, 4 |
| 主 Agent 隔离（Buddy） | 6 bridge |
| Schema 预留 mood/recommendations/position | 1, 2 |

### 后加 + Buddy 扩展（任务 8–12）

| 规格项 | 任务 |
|--------|------|
| 心情检测改人格 | 8 |
| 对话任务推荐 | 9 |
| Reactor 限频旁观（Buddy） | 10 |
| 自由像素位移 | 11 |
| FloatIcon/Sprite 联动 | 12 |
| 不抄 gacha | 全程 |

## 风险与降级

- **Provider 单次调用难接：** `/api/pet/scene-script` 先返回 fallback JSON，Director 链路不变，真 LLM 作 follow-up。
- **对话页无左右留白 DOM：** chat zones 不可用时一律回退 `zone_composer`。
- **主会话 system 注入点不明：** bridge 先导出，不阻塞 UI 交付。
- **后续任务依赖：** 8–10 依赖 Phase 1 气泡通道与 Schema 预留；11 依赖 Zone 几何；12 依赖 Identity/Store persist 稳定。

---

## 执行交接

计划已保存到 `sto-claw/docs/superpowers/plans/2026-07-13-sto-lobster-pet-phase1.md`（文件名保留 phase1，正文含全部分期）。

**建议执行顺序：** 先 1–7 上线可玩；再 8→9→10→11→12。

**两种执行方式：**

1. **子代理驱动（推荐）** — 每个任务调度一个新子代理，任务间审查  
2. **内联执行** — 当前会话按任务推进并设检查点  

选哪种方式？
