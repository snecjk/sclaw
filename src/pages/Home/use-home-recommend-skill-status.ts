/* eslint-disable react-hooks/set-state-in-effect */
/**
 * 首页推荐位技能状态 hook（独立实现，不依赖技能广场 store）。
 *
 * 状态判定三步骤：
 *  1. 由 recommend 列表抽取出 skill id（slug）；
 *  2. 并发拉取「云端全量 skill 列表」与「本地已安装 skill 列表」；
 *  3. 三者比对，得出每个 skill 的状态：未安装 / 已安装 / 待更新。
 *
 * loading 语义：
 *  - 初始化 / 推荐位变化（全量刷新）：整体 loading=true，所有 skill 卡底部转圈，
 *    待第 2 步两请求都返回后才结束、确认状态；
 *  - 安装 / 更新后刷新单卡（单卡刷新）：不触发整体 loading，仅 refreshingSlugs
 *    标记当前 slug，loading 只影响被操作的那张卡。
 */
import { useState, useRef, useEffect } from 'react';
import { fetchSkillPlazaList, fetchLocalSkillsBySlugs } from '@/lib/skill-plaza-api';
import { isRemoteVersionNewer } from '@/lib/skill-version';
import type { SkillSummary } from '@/types/skill-plaza';
import type { RecommendItem } from '@/lib/recommend-api';

export interface SkillStatusEntry {
  installed: boolean;
  updateAvailable: boolean;
  /** 云端 plaza 返回的最新版本号；安装/更新时用它写入 lock，避免推荐位未带版本而兜底为 1.0.0 */
  cloudVersion?: string;
}

export type SkillStatusMap = Record<string, SkillStatusEntry>;

interface SkillStatusState {
  map: SkillStatusMap;
  loading: boolean;
}

/** 拉取云端全量 skill 列表（official + mine 两个 source 各自分页合并）。
 *  关键：后端 /plaza 接口不传 source 时 Python 默认只返回 official；
 *  而推荐位可能含 source=mine 的用户自建 skill（如 my-skills-*），不带 mine 拉取
 *  会导致 cloudFound=false，版本对比与 updateAvailable 全部失效。故必须两个 source 都拉。
 *  注意：后端 Python API 限制 page_size ≤ 50，超出返回 422，故固定用 50。 */
async function fetchAllCloudSkills(): Promise<SkillSummary[]> {
  const pageSize = 50;
  const MAX_PAGES = 20; // 保护上限：每 source 20 页 × 50 = 1000，覆盖现有规模

  async function fetchAllSource(source: 'official' | 'mine'): Promise<SkillSummary[]> {
    const all: SkillSummary[] = [];
    let page = 1;
    for (let i = 0; i < MAX_PAGES; i += 1) {
      const res = await fetchSkillPlazaList({ source, page, pageSize });
      all.push(...res.skills);
      if (!res.hasMore || res.skills.length === 0) break;
      page += 1;
    }
    return all;
  }

  const [official, mine] = await Promise.all([fetchAllSource('official'), fetchAllSource('mine')]);
  // 按 slug 去重（mine 与 official slug 极少重叠；重叠时 official 优先保留，因官方版本更权威）
  const dedup = new Map<string, SkillSummary>();
  for (const s of [...mine, ...official]) {
    if (!dedup.has(s.slug)) dedup.set(s.slug, s);
  }
  return [...dedup.values()];
}

export function useHomeRecommendSkillStatus(recommendItems: RecommendItem[]) {
  const [state, setState] = useState<SkillStatusState>({ map: {}, loading: true });
  const [refreshingSlugs, setRefreshingSlugs] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  // 云端全量列表缓存：单卡刷新时复用（云端版本不受本地安装影响），只重拉本地列表
  const cloudSkillsRef = useRef<SkillSummary[] | null>(null);

  const skillSlugs = recommendItems
    .filter((i) => i.item_type === 'skill')
    .map((i) => i.skill_slug || i.item_ref_id);
  const skillSlugsKey = skillSlugs.join(',');

  const doFetch = async (slug?: string) => {
    // 取消进行中的请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // 无 skill 条目：不重置 loading 标志，避免从空 → 非空时短暂显示兜底状态
    if (skillSlugs.length === 0) {
      return;
    }

    // 全量刷新（初始化 / 推荐位变化）：整体 loading，所有 skill 卡底部转圈；
    // 单卡刷新（安装 / 更新后）：不设整体 loading，仅 refreshingSlugs 控制当前卡
    if (!slug) {
      setState((prev) => ({ ...prev, loading: true }));
    }

    try {
      // 单卡刷新复用云端缓存（云端版本不受本地安装影响），只重拉本地
      const reuseCloud = Boolean(slug && cloudSkillsRef.current);
      const cloudPromise: Promise<SkillSummary[]> = reuseCloud
        ? Promise.resolve(cloudSkillsRef.current!)
        : fetchAllCloudSkills();

      const [cloudSkills, localResult] = await Promise.all([
        cloudPromise,
        fetchLocalSkillsBySlugs(skillSlugs),
      ]);

      if (controller.signal.aborted) return;

      if (!reuseCloud) {
        cloudSkillsRef.current = cloudSkills;
      }

      const mySkills = localResult.skills;

      const recommendVersionBySlug = new Map<string, string>();
      for (const item of recommendItems) {
        if (item.item_type === 'skill' && item.skill_version) {
          const slug = item.skill_slug || item.item_ref_id;
          recommendVersionBySlug.set(slug, item.skill_version);
        }
      }

      // ===== DEBUG: 排查安装/更新状态判定 =====
      // 控制台过滤关键字：[HomeSkillStatus]
      console.log('[HomeSkillStatus] recommend 抽取的 skillSlugs =', skillSlugs);
      console.log(
        '[HomeSkillStatus] 云端全量 cloudSkills 共', cloudSkills.length, '个；slug 列表 =',
        cloudSkills.map((s) => s.slug),
      );
      console.log(
        '[HomeSkillStatus] 本地 mySkills 共', mySkills.length, '个；slug 列表 =',
        mySkills.map((s) => ({ slug: s.slug, version: s.version, installedVersion: s.installedVersion })),
      );
      console.log('[HomeSkillStatus] recommendVersionBySlug =', Object.fromEntries(recommendVersionBySlug));
      // ===== DEBUG END =====

      // 三方对比：recommend(提供 skill id) ∘ 云端全量 skill 列表 ∘ 本地已装 skill 列表
      // 关键：本地扫盘的 slug = skill 目录名，可能与 DB slug 不一致（Gateway 可能用 SKILL.md
      // 的 name 作为目录名，见 stores/skills.ts 的宽松合并注释）。因此「已安装」不能仅靠
      // mySkills.find(slug) 精确匹配——会因目录名≠DB slug 而误判为未安装。
      // 云端 plaza 列表的 installed 字段由后端用 lock.json(DB slug) + 目录对比，更可靠，
      // 故以其为主；本地列表做大小写不敏感的宽松匹配兜底（应对自建 skill 不在云端市场、
      // cloudSkill 未命中的场景）。
      const map: SkillStatusMap = {};
      for (const s of skillSlugs) {
        const cloudSkill = cloudSkills.find((sk) => sk.slug === s);
        const installedSkill = mySkills.find(
          (sk) =>
            sk.slug === s ||
            (sk.slug != null && sk.slug.toLowerCase() === s.toLowerCase()),
        );

        // installed: 云端后端对比结果为主（含 lock.json，目录名≠DB slug 也能识别已安装）；
        // 本地宽松匹配兜底（应对自建 skill 不在云端市场、cloudSkill 未命中的场景）
        const installed = Boolean(cloudSkill?.installed) || Boolean(installedSkill);

        let updateAvailable = false;
        if (installed) {
          const recommendVersion = recommendVersionBySlug.get(s);
          const cloudVersion = cloudSkill?.version ?? installedSkill?.version ?? recommendVersion;
          const localVersion =
            installedSkill?.installedVersion ??
            cloudSkill?.installedVersion;
          // 前端版本对比优先：单卡刷新后本地 lock 已更新，云端缓存的 updateAvailable
          // 仍是对比旧 lock 的结果（stale），会误判为"有更新"。仅当双方版本缺失、无法
          // 对比时（如自建 skill 不在云端市场），才回退到后端对比结果（云端优先，
          // 云端缺失时回退到本地列表的 updateAvailable —— getLocalSkills 已用 plaza
          // 版本对比 lock，可覆盖云端列表过滤掉该 skill 的场景）。
          const frontendVerdict =
            cloudVersion && localVersion
              ? isRemoteVersionNewer(cloudVersion, localVersion)
              : null;
          updateAvailable =
            frontendVerdict !== null
              ? frontendVerdict
              : Boolean(cloudSkill?.updateAvailable ?? installedSkill?.updateAvailable);

          // ===== DEBUG: 每个推荐 skill 的三方匹配详情 =====
          console.log('[HomeSkillStatus] 对比', {
            slug: s,
            cloudFound: Boolean(cloudSkill),
            cloudInstalled: cloudSkill?.installed,
            cloudVersion_raw: cloudSkill?.version,
            cloudInstalledVersion: cloudSkill?.installedVersion,
            cloudUpdateAvailable: cloudSkill?.updateAvailable,
            localFound: Boolean(installedSkill),
            localSlug: installedSkill?.slug,
            localVersion_raw: installedSkill?.version,
            localInstalledVersion: installedSkill?.installedVersion,
            localUpdateAvailable: installedSkill?.updateAvailable,
            recommendVersion_fallback: recommendVersion,
            最终_cloudVersion: cloudVersion,
            最终_localVersion: localVersion,
            前端判定_frontendVerdict: frontendVerdict,
            决定_installed: installed,
            决定_updateAvailable: updateAvailable,
          });
          // ===== DEBUG END =====
        }

        map[s] = { installed, updateAvailable, cloudVersion: cloudSkill?.version ?? recommendVersionBySlug.get(s) };
      }

      if (mountedRef.current && !controller.signal.aborted) {
        setState({ map, loading: false });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[useHomeRecommendSkillStatus] Failed to fetch skill status:', err);
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, loading: false }));
      }
    } finally {
      if (slug && mountedRef.current) {
        setRefreshingSlugs((prev) => {
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
      }
    }
  };

  // 首次加载 & skillSlugs 变化时重新拉取
  useEffect(() => {
    mountedRef.current = true;
    // doFetch 是 async，setState 全在 await 之后，不存在同步 cascading 问题
    void doFetch();
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skillSlugsKey 是 skillSlugs 的稳定序列化依赖
  }, [skillSlugsKey]);

  // 安装/更新后刷新指定技能的状态
  const handleRefresh = (slug?: string) => {
    if (slug) {
      setRefreshingSlugs((prev) => new Set(prev).add(slug));
    }
    void doFetch(slug);
  };

  return {
    skillStatusMap: state.map,
    loading: state.loading,
    refreshingSlugs,
    handleRefresh,
  };
}
