# 申通龙虾电子宠物（Sto Lobster Pet）设计规格

> 日期：2026-07-13  
> 仓库：`sto-claw`  
> 状态：草案待审（已吸收 Claude Code Buddy 可借鉴点）  
> 范围：主窗口多区域陪伴公仔；定时应景互动为第一交付；心情/推荐/自由位移/桌面联动纳入同一产品路线

## 1. 背景与目标

在 SClaw 主工作区（输入框附近及对话留白等）增加可动的申通龙虾小公仔：按场景变形态、给情绪价值，并可延伸任务推荐。用户标注的首发落点在输入区右上一带，但产品形态是「会窜区」的多区域舞台，而非钉死单点装饰。

**成功体验：** 到点先短开场白；点击或超时后展开完整话术与快捷回复；模型提前生成好剧本，失败有本地兜底；不硬打断正在流式的对话；宠物与主助手各说各话、互不抢戏。

## 2. 从 Claude Buddy 吸收什么 / 刻意不抄什么

参考本机 Claude Code 源码 `src/buddy/`（Bones/Soul、CompanionSprite、companionReact、prompt 隔离）。

### 2.1 吸收（为自己所用）

| Buddy 做法 | 落到本规格 |
|------------|------------|
| **宠物 ≠ 主助手**（`prompt.ts`：Buddy is a separate watcher） | Director / Reactor 与主会话隔离；主 Agent 注入短 intro：龙虾是旁观者，被点名时主模型少说话 |
| **渲染循环与内容解耦**（500ms idle tick；气泡另路注入） | `PetStage` 常驻 idle（蠕动/眨眼）；话术由 Scheduler/Director/Reactor 推送，动画不等人 |
| **限频冒泡**（约 45s；叫名字可绕过） | 定时档另算；回合后短评（Phase 2）默认 ≥45s；用户点名/点击公仔可立即展开 |
| **两段身份：Bones + Soul** | 见 §3：外观身份可确定性绑定账号；名字/口头禅一次生成后持久化 |
| **Mute / 显隐**（`companionMuted`） | 设置项：静音气泡、隐藏公仔；消费态与 mute 分开 |
| **回合后旁观短评**（`companionReact`） | Phase 2：对话空闲后可选轻量 Reactor，与定时 Script 共用气泡 UI |
| **气泡自动淡出** | greeting/body 展示有寿命；超时展开后 body 也可在无操作一段时间后收起（默认 20–30s，可配） |

### 2.2 刻意不抄

| Buddy 做法 | 原因 |
|------------|------|
| 18 物种抽卡 / 稀有度 / 闪光 gacha | 品牌固定「申通龙虾」；不做养成赌概率 |
| 终端 ASCII 固定贴输入框旁 | 我们是 GUI 多 Zone + 后续自由位移 |
| 仅回合驱动、无定时应景 | 我们以定时四档为 Phase 1 主干 |
| 主模型完全让开、只靠旁路 API 说话 | 我们保留快捷回复进 Composer，可驱动主任务 |

## 3. 身份层（Bones / Soul 本地化）

不做抽卡，但保留「稳定身份 + 一次灵魂」：

| 层 | 内容 | 规则 |
|----|------|------|
| **Bones（外观骨架）** | 基础龙虾造型变体索引（配色/配饰枚举，数量少）、默认 idle 姿态 | 可由 `accountId/userId + salt` 确定性算出，或全员统一品牌造型；**不强调稀有度** |
| **Soul（灵魂）** | 昵称（如「小钳钳」）、一句口头禅、偏好语气标签 | 首次启用时由模型生成一次，写入本地配置；之后复用，不因重装会话而变（除非用户显式「重新认识」） |
| **Persona（场景人格）** | 拉拉队长 / 毛毛虫 / 亲听者… | **临时披风**：按时段或 mood 切换，不覆盖 Soul 昵称 |

`getPetIdentity()`：合并 stored soul + bones；persona 只影响当前 Script / 动画皮肤。

## 4. 架构总览

四层分工：

1. **Zone 地图** — 客户端圈定大区域；Phase 1 模型只选 zone 枚举 + motion。  
2. **Director** — 定时预生成 Scene Script（提前 5–10 分钟）；失败走兜底。  
3. **Reactor（Phase 2）** — 回合结束后旁观短评；限频；与 Director 共用气泡通道。  
4. **PetStage** — idle 渲染循环 + 两段式冒泡演出；不关心文案从哪条链路来。

```text
Identity (bones + soul)
        │
Scheduler ──► Director (prefetch Script) ──► Script Cache
Turn end  ──► Reactor  (rate-limited)   ──► Reaction Queue   ┐
Busy/Mute/Zone rules ───────────────────────────────────────┤
                                                            ▼
                                                     PetStage (idle + bubble)
                                                            │
                                              Composer / 主 Agent intro 隔离
```

**硬隔离：** Director / Reactor 调用不写入用户主聊天历史；仅通过 PetStage 展示。主会话可附带极短 `pet_intro` 元信息（类似 Buddy `companion_intro` attachment），告知主模型「旁有龙虾叫 X，被点名时少抢话」。

## 5. 大区域（Zone）与动作（Motion）

### 5.1 Phase 1 Zone 枚举

| zone id | 含义 |
|---------|------|
| `zone_composer` | 输入框一带（蠕动 / 冒头 / 偷瞄） |
| `zone_chat_left` | 对话页左侧留白 |
| `zone_chat_right` | 对话页右侧留白 |

Zone 不可用时回退：`zone_chat_*` → `zone_composer`。

### 5.2 Motion 枚举（Phase 1）

| motion | 表现 |
|--------|------|
| `crawl` | 蠕动接近 |
| `peek` | 冒头 |
| `glance` | 偷瞄 |

### 5.3 后续扩展

- Phase 3：自由像素位移（安全矩形内）  
- Phase 4：与桌面 `FloatIcon` / `Sprite` 共享 Identity + 同一状态机  

## 6. 时段与人格（Phase 1 四档）

| slotId | 触发窗口（本地时） | 默认 persona | 语气与目的 | 兜底 zone + motion |
|--------|-------------------|--------------|------------|-------------------|
| `morning_start` | 09:00–09:20 | `cheer_captain` 拉拉队长 | 短促打气 | `zone_composer` + `peek` |
| `lunch` | 12:00–12:30 | `lazy_caterpillar` 慵懒毛毛虫 | 催吃饭、放松 | `zone_composer` + `crawl` |
| `offwork` | 18:00–18:30 | `offwork_nudge` 下班提醒者 | 收尾、提醒离开 | `zone_composer` + `peek` |
| `late_night` | 21:00 后首次空闲 | `empathic_listener` 亲听者 | 共情、劝歇 | `zone_chat_right` + `peek`（无对话页则 composer） |

**频控：** 每档每天最多完整互动 1 次；关闭或展开后均记「本档已消费」。  
**忙时：** 流式中不打断；窗口内延后到空闲再出场，仍计本档一次。  
Phase 1 以该档默认 persona 为主；`zone` / `motion` / 话术由模型在枚举内选。Soul 昵称可嵌入 greeting（如「早上好，我的小主人——我是小钳钳」）。

## 7. Scene Script 与两段式演出

### 7.1 字段

```ts
type PetSceneScript = {
  slotId: 'morning_start' | 'lunch' | 'offwork' | 'late_night';
  persona:
    | 'cheer_captain'
    | 'lazy_caterpillar'
    | 'offwork_nudge'
    | 'empathic_listener';
  zone: 'zone_composer' | 'zone_chat_left' | 'zone_chat_right';
  motion: 'crawl' | 'peek' | 'glance';
  greeting: string; // 开场白，≤20 字，如「早上好，我的小主人」
  body: string; // 点击或超时后展开，≤80 字
  replies: string[]; // 1–3 条，每条 ≤12 字；仅展开后显示
  waitMs: number; // 不点则自动展开；默认 8000
  expiresAt: number; // 过窗作废
  // —— 后续阶段预留 ——
  moodHint?: 'upbeat' | 'tired' | 'stressed' | 'neutral';
  recommendations?: Array<{ title: string; prompt: string }>;
  position?: { x: number; y: number };
};
```

### 7.2 预生成

- 窗口开始前 **5–10 分钟**启动 Director。  
- 上下文：是否 Home、是否有活跃会话、是否流式、本地时刻、slot 默认 persona、**Soul 昵称**。Phase 1 不塞长对话全文。  
- 成功写 Cache（`slotId + localDate`）；失败到点走兜底；**到点不现场等模型**。

### 7.3 两段式演出

```text
出场 → 公仔 idle + greeting
  ├─ 用户点击公仔/气泡 → 立即展开 body + replies
  └─ 超过 waitMs 未点 → 自动展开 body + replies
展开后：
  ├─ 点快捷回复 → 填入/发送 Composer，收回，本档已消费
  └─ 点关闭 / body 展示超时 → 收回，本档已消费
自动展开不抢输入框焦点，不自动发送。
```

## 8. Reactor（Phase 2，吸收 Buddy 回合旁观）

- 触发：一轮用户↔助手结束后，且非 mute、非流式。  
- 限频：默认 **≥45s** 才可再冒短评；用户**点击公仔**或**在输入中点名 Soul 昵称**可立即请求一次。  
- 产出：短气泡 ≤40 字（可无 replies）；走 Reaction Queue，**不覆盖**未消费的定时 Script（定时档优先；冲突则丢弃本次 react）。  
- 上下文：近几轮摘要（截断），禁止写入主历史。  
- 与心情检测（2a）、任务推荐（2b）共用 Reactor/Director 扩展字段。

## 9. 模块落点（`sto-claw`）

| 模块 | 职责 |
|------|------|
| `pet/identity.ts` | Bones 计算 + Soul 读写；`getPetIdentity()` |
| `pet/zones.ts` | Zone 锚点注册与可用性 |
| `pet/scheduler.ts` | 四档窗口、每日频控、忙时延后 |
| `pet/director.ts` | 定时预生成、Schema 校验、Cache |
| `pet/reactor.ts` | 回合后短评、限频、点名检测（Phase 2） |
| `pet/fallback.ts` | 各档本地兜底 Script |
| `pet/store.ts` | Cache、消费态、mute/hidden、演出态 |
| `pet/PetStage.tsx` | idle 渲染循环 + 气泡两段式 |
| `pet/main-agent-bridge.ts` | 向主会话注入/更新 `pet_intro`（隔离说明） |
| 壳层挂载 | Home / 对话壳 Zone 锚点；`PetStage` 单例 |

与现有 `HomeComposer`、`FloatIcon`/`Sprite` 解耦；Phase 4 共享 `identity` + `store`。

## 10. 交互与避让（硬规则）

1. 流式中不硬插；延后到空闲。  
2. Zone 不可用则回退 `zone_composer`。  
3. 定时档每天每档最多 1 次完整互动。  
4. 自动展开不抢焦点、不自动发送。  
5. Director / Reactor **不写入**主聊天历史。  
6. 主 Agent 不得冒充龙虾说话；被点名时主模型短答或让开。  
7. mute 时：不预生成催办式打扰可保留 Cache，但 **PetStage 不展示**；用户取消 mute 后按规则恢复。  
8. Reactor 短评不得打断未完成的定时两段式演出。

## 11. 分期路线

| 阶段 | 交付 | 说明 |
|------|------|------|
| **Phase 1** | Identity（简版 Soul）+ 定时四档 + Zone/motion + 预生成 + 两段式 + 兜底 + 快捷回复 + idle 循环 + mute + 主 Agent intro 隔离 | 第一可上线切片；吸收 Buddy 的隔离/渲染解耦/显隐 |
| **Phase 2a** | 心情检测改人格 | mood 可覆盖同档默认 persona |
| **Phase 2b** | 对话任务推荐 | `recommendations` 点击注入 Composer |
| **Phase 2c** | Reactor 回合旁观短评 | 限频 + 点名加速（对齐 Buddy companionReact） |
| **Phase 3** | 自由像素位移 | 安全矩形内；Zone 作边界 |
| **Phase 4** | FloatIcon / Sprite 联动 | 共享 Identity 与状态机；避免双脑双泡 |

**顺序建议：** 1 → 2a/2b/2c（可并行）→ 3 → 4。

## 12. 非目标

- Phase 1 不做用户自定义时段 UI。  
- **不做**稀有度抽卡、喂食升级等养成数值游戏。  
- mood 仅来自应用内行为与对话信号，不读无关系统传感器。

## 13. 验收标准

### Phase 1

- [ ] 四档窗口内能出场；每天每档最多一次。  
- [ ] 先出 `greeting`；点击或 `waitMs` 后出 `body` + `replies`。  
- [ ] 冒泡时不现场等模型；失败有兜底。  
- [ ] 流式中延后；快捷回复进 Composer。  
- [ ] AI 仅从 zone/motion 枚举选择。  
- [ ] PetStage 有独立 idle，无 Script 时也可轻动（可弱可关）。  
- [ ] mute/隐藏生效；主 Agent 不冒充龙虾。  
- [ ] Soul 昵称首次生成后持久，并出现在开场白中（若已孵化）。

### Phase 2+

- [ ] 心情可改 persona，有兜底。  
- [ ] 推荐可点注入输入框。  
- [ ] Reactor 限频生效；点名/点击可加速。  
- [ ] 自由位移不挡关键控件。  
- [ ] FloatIcon/Sprite 与主窗口状态一致，无双重冒泡。

## 14. 已锁定决策摘要

| 项 | 决策 |
|----|------|
| 互动深度 | 可点短互动 + 超时自动展开全文 |
| 文案来源 | 模型预生成；失败本地兜底 |
| 选位方式 | 客户端圈定大区域，AI 选 zone + motion + 话术 |
| 首发触发 | 定时四档 |
| 身份 | Bones（轻量）+ Soul（一次生成）；Persona 为场景披风 |
| 隔离 | 宠物通道 ⊥ 主会话；主模型不抢戏 |
| 渲染 | idle 循环与内容管道解耦 |
| 扩展 | 心情、推荐、Reactor、自由位移、桌面联动分期交付 |
| 不抄 | gacha 稀有度、纯 ASCII 单点贴附 |
