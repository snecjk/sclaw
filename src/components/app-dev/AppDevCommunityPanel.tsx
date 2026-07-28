/**
 * Community tab — package skills + 开发辅助 (OpenSpec skills from engineering template).
 */
import { useEffect, useState } from 'react';
import { Boxes, Check, Loader2, Package, Sparkles, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  installAppDevAssistSkill,
  installAppNpmPackage,
  installAppPipPackage,
  listAppDevAssistSkills,
  type AppDevAssistSkill,
} from '@/lib/app-dev-api';
import { cn } from '@/lib/utils';

type CommunitySection = 'assist' | 'frontend' | 'backend';

interface PackageSkillItem {
  id: string;
  kind: 'frontend' | 'backend';
  name: string;
  packageName: string;
  description: string;
}

const PACKAGE_SKILLS: PackageSkillItem[] = [
  {
    id: 'fe-axios',
    kind: 'frontend',
    name: 'Axios',
    packageName: 'axios',
    description: '常用 HTTP 请求库，适合对接公司接口。',
  },
  {
    id: 'fe-dayjs',
    kind: 'frontend',
    name: 'Day.js',
    packageName: 'dayjs',
    description: '轻量日期时间处理。',
  },
  {
    id: 'fe-clsx',
    kind: 'frontend',
    name: 'clsx',
    packageName: 'clsx',
    description: '条件拼接 className。',
  },
  {
    id: 'fe-recharts',
    kind: 'frontend',
    name: 'Recharts',
    packageName: 'recharts',
    description: 'React 图表组件。',
  },
  {
    id: 'be-fastapi',
    kind: 'backend',
    name: 'FastAPI',
    packageName: 'fastapi',
    description: 'Python Web API 框架。',
  },
  {
    id: 'be-uvicorn',
    kind: 'backend',
    name: 'Uvicorn',
    packageName: 'uvicorn',
    description: 'ASGI 服务器，配合 FastAPI 使用。',
  },
  {
    id: 'be-requests',
    kind: 'backend',
    name: 'Requests',
    packageName: 'requests',
    description: 'Python HTTP 客户端。',
  },
  {
    id: 'be-httpx',
    kind: 'backend',
    name: 'HTTPX',
    packageName: 'httpx',
    description: '支持异步的 Python HTTP 客户端。',
  },
  {
    id: 'be-pydantic',
    kind: 'backend',
    name: 'Pydantic',
    packageName: 'pydantic',
    description: '数据校验与模型定义。',
  },
];

interface AppDevCommunityPanelProps {
  workspaceId: string;
}

export function AppDevCommunityPanel({ workspaceId }: AppDevCommunityPanelProps) {
  const [section, setSection] = useState<CommunitySection>('assist');
  const [customName, setCustomName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [assistSkills, setAssistSkills] = useState<AppDevAssistSkill[]>([]);
  const [assistLoading, setAssistLoading] = useState(false);

  const refreshAssist = async () => {
    setAssistLoading(true);
    try {
      setAssistSkills(await listAppDevAssistSkills(workspaceId));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法加载开发技能');
    } finally {
      setAssistLoading(false);
    }
  };

  useEffect(() => {
    void refreshAssist();
  }, [workspaceId]);

  const installPackage = async (
    skillId: string,
    packageName: string,
    kind: 'frontend' | 'backend',
  ) => {
    const name = packageName.trim();
    if (!name || busyId) return;
    setBusyId(skillId);
    try {
      if (kind === 'frontend') {
        await installAppNpmPackage(workspaceId, name);
        toast.success(`已安装前端包 ${name}`, {
          description: '已执行 npm install --save，写入 frontend/package.json',
        });
      } else {
        await installAppPipPackage(workspaceId, name);
        toast.success(`已安装 Python 包 ${name}`, {
          description: '已用 uv 安装到 backend/.venv，并写入 requirements.txt',
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '安装失败');
    } finally {
      setBusyId(null);
    }
  };

  const installAssist = async (skillId: string) => {
    if (!skillId || busyId) return;
    setBusyId(skillId);
    try {
      const result = await installAppDevAssistSkill(workspaceId, skillId);
      toast.success(`已启用 ${skillId}`, {
        description: `已写入本应用 ${result.targetPath}`,
      });
      await refreshAssist();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启用失败');
    } finally {
      setBusyId(null);
    }
  };

  const packageItems = PACKAGE_SKILLS.filter((item) => item.kind === section);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Users className="h-4 w-4" aria-hidden />
            社区
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            开发辅助技能来自本应用工程模板的
            {' '}
            <code className="text-[11px]">openspec/skill-catalog</code>
            ，启用后写入
            {' '}
            <code className="text-[11px]">openspec/skills/</code>
            （属于用户应用，不是 SClaw 客户端仓库）。
          </p>
        </header>

        <div className="inline-flex w-fit flex-wrap rounded-lg border border-border bg-muted/40 p-0.5">
          {(
            [
              { id: 'assist', label: '开发辅助', icon: Sparkles },
              { id: 'frontend', label: '前端组件包', icon: Package },
              { id: 'backend', label: '后端 Python 包', icon: Boxes },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors',
                  section === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                aria-pressed={section === tab.id}
                onClick={() => setSection(tab.id)}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {tab.label}
              </button>
            );
          })}
        </div>

        {section === 'assist' ? (
          <section className="space-y-2">
            {assistLoading && assistSkills.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
            ) : assistSkills.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                工程模板中暂无开发技能目录
              </p>
            ) : (
              assistSkills.map((skill) => {
                const busy = busyId === skill.id;
                return (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{skill.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{skill.description}</p>
                    </div>
                    {skill.installed ? (
                      <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-muted-foreground">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        已启用
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 shrink-0 gap-1.5 px-3 text-xs"
                        disabled={Boolean(busyId)}
                        onClick={() => void installAssist(skill.id)}
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                        安装
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </section>
        ) : (
          <>
            <section className="space-y-2">
              {packageItems.map((skill) => {
                const busy = busyId === skill.id;
                return (
                  <div
                    key={skill.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/70 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{skill.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        {skill.packageName}
                        {' · '}
                        {skill.description}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5 px-3 text-xs"
                      disabled={Boolean(busyId)}
                      onClick={() => void installPackage(skill.id, skill.packageName, skill.kind)}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                      安装
                    </Button>
                  </div>
                );
              })}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-background/70 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                自定义包名
              </h3>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={section === 'frontend' ? '例如 lodash 或 @scope/pkg' : '例如 pandas'}
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void installPackage('custom', customName, section);
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5 text-xs"
                  disabled={Boolean(busyId) || !customName.trim()}
                  onClick={() => void installPackage('custom', customName, section)}
                >
                  {busyId === 'custom' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  安装
                </Button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
