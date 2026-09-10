/**
 * AppDevVersionsStore — 轮次 turnKey ↔ checkpoint commit 映射（P1 交互改造 T04）。
 *
 * 映射建立流程（同一会话多轮 / 中断轮均按 FIFO 对齐）：
 * 1. WorkbenchChatPane 在轮结束（sending true→false）时 recordPendingTurn，
 *    记录 turnKey / 用户消息摘要 / 结束时间（此时 hash 尚未知）；
 * 2. AppPlazaDevAppPane 的轮结束 effect 创建 checkpoint 拿到 hash 后
 *    completePendingTurn（created）或 discardPendingTurn（clean-head/failed），
 *    两个路径都精确消费队列头一个 pending，保证多轮顺序不错位。
 *
 * versionsByWorkspace persist 到 localStorage（键 stoclaw:app-dev-versions-v1），
 * pending 队列是瞬态握手数据，不落盘；映射缺失时读取侧按时间戳最近邻降级对齐。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AppDevTurnVersion {
  hash: string;
  subject: string;
  /** checkpoint 创建时间（ms）。 */
  timestamp: number;
  /** 轮次结束时间（ms）。 */
  turnEndedAt: number;
  userTextExcerpt: string;
}

export interface AppDevPendingTurn {
  /** 轮次稳定 key；极端情况下取不到时为 null（占位保序，complete 时不写映射）。 */
  turnKey: string | null;
  userTextExcerpt: string;
  endedAt: number;
}

/** 单 workspace 最多保留的轮次映射条数（超出丢弃最旧）。 */
const MAX_VERSIONS_PER_WORKSPACE = 100;
/** pending 队列上限（防御：complete/discard 缺失时不至于无限堆积）。 */
const MAX_PENDING_TURNS = 20;

interface AppDevVersionsState {
  /** workspaceId → turnKey → 版本记录。 */
  versionsByWorkspace: Record<string, Record<string, AppDevTurnVersion>>;
  /** workspaceId → 待补 hash 的轮次队列（FIFO）。 */
  pendingTurnsByWorkspace: Record<string, AppDevPendingTurn[]>;
  recordPendingTurn: (workspaceId: string, pending: AppDevPendingTurn) => void;
  /** 查看队首 pending（outer pane 用它生成 commit subject），不出队。 */
  peekPendingTurn: (workspaceId: string) => AppDevPendingTurn | null;
  /** checkpoint 创建成功：队首 pending 补 hash 落映射并出队；空队列返回 null。 */
  completePendingTurn: (
    workspaceId: string,
    input: { hash: string; subject: string; timestamp?: number },
  ) => AppDevTurnVersion | null;
  /** checkpoint 未创建（clean-head/failed）：丢弃队首 pending，保持队列对齐。 */
  discardPendingTurn: (workspaceId: string) => void;
}

function trimVersions(
  versions: Record<string, AppDevTurnVersion>,
): Record<string, AppDevTurnVersion> {
  const keys = Object.keys(versions);
  if (keys.length <= MAX_VERSIONS_PER_WORKSPACE) return versions;
  const sorted = keys.sort(
    (a, b) => (versions[a]?.timestamp ?? 0) - (versions[b]?.timestamp ?? 0),
  );
  const next = { ...versions };
  for (const key of sorted.slice(0, keys.length - MAX_VERSIONS_PER_WORKSPACE)) {
    delete next[key];
  }
  return next;
}

export const useAppDevVersionsStore = create<AppDevVersionsState>()(
  persist(
    (set, get) => ({
      versionsByWorkspace: {},
      pendingTurnsByWorkspace: {},

      recordPendingTurn: (workspaceId, pending) => {
        if (!workspaceId) return;
        set((state) => {
          const queue = [...(state.pendingTurnsByWorkspace[workspaceId] ?? []), pending]
            .slice(-MAX_PENDING_TURNS);
          return {
            pendingTurnsByWorkspace: {
              ...state.pendingTurnsByWorkspace,
              [workspaceId]: queue,
            },
          };
        });
      },

      peekPendingTurn: (workspaceId) => {
        const queue = get().pendingTurnsByWorkspace[workspaceId];
        return queue && queue.length > 0 ? queue[0] ?? null : null;
      },

      completePendingTurn: (workspaceId, input) => {
        if (!workspaceId || !input.hash) return null;
        let created: AppDevTurnVersion | null = null;
        set((state) => {
          const queue = [...(state.pendingTurnsByWorkspace[workspaceId] ?? [])];
          const pending = queue.shift() ?? null;
          if (!pending) {
            // 空队列：保持原状，避免写出空 workspace 条目。
            return {
              pendingTurnsByWorkspace: {
                ...state.pendingTurnsByWorkspace,
                [workspaceId]: queue,
              },
            };
          }
          const nextVersions = { ...(state.versionsByWorkspace[workspaceId] ?? {}) };
          if (pending.turnKey) {
            created = {
              hash: input.hash,
              subject: input.subject,
              timestamp: input.timestamp ?? Date.now(),
              turnEndedAt: pending.endedAt,
              userTextExcerpt: pending.userTextExcerpt,
            };
            nextVersions[pending.turnKey] = created;
          }
          return {
            versionsByWorkspace: {
              ...state.versionsByWorkspace,
              [workspaceId]: trimVersions(nextVersions),
            },
            pendingTurnsByWorkspace: {
              ...state.pendingTurnsByWorkspace,
              [workspaceId]: queue,
            },
          };
        });
        return created;
      },

      discardPendingTurn: (workspaceId) => {
        set((state) => {
          const queue = [...(state.pendingTurnsByWorkspace[workspaceId] ?? [])];
          queue.shift();
          return {
            pendingTurnsByWorkspace: {
              ...state.pendingTurnsByWorkspace,
              [workspaceId]: queue,
            },
          };
        });
      },
    }),
    {
      name: 'stoclaw:app-dev-versions-v1',
      version: 1,
      partialize: (state) => ({ versionsByWorkspace: state.versionsByWorkspace }),
      // 兜底非法持久化值：结构不对就清空，避免渲染侧读到脏数据崩溃。
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppDevVersionsState>;
        const raw = p.versionsByWorkspace;
        const versionsByWorkspace: AppDevVersionsState['versionsByWorkspace'] = {};
        if (raw && typeof raw === 'object') {
          for (const [workspaceId, versions] of Object.entries(raw)) {
            if (!versions || typeof versions !== 'object') continue;
            const clean: Record<string, AppDevTurnVersion> = {};
            for (const [turnKey, record] of Object.entries(versions)) {
              if (record && typeof record.hash === 'string' && record.hash) {
                clean[turnKey] = {
                  hash: record.hash,
                  subject: typeof record.subject === 'string' ? record.subject : '',
                  timestamp: typeof record.timestamp === 'number' ? record.timestamp : 0,
                  turnEndedAt: typeof record.turnEndedAt === 'number' ? record.turnEndedAt : 0,
                  userTextExcerpt: typeof record.userTextExcerpt === 'string'
                    ? record.userTextExcerpt
                    : '',
                };
              }
            }
            versionsByWorkspace[workspaceId] = clean;
          }
        }
        return { ...current, versionsByWorkspace };
      },
    },
  ),
);
