/**
 * Cloud service tab — upload frontend dist / backend Python with server forms.
 * Actions are stubs with fake default credentials until real deploy APIs exist.
 */
import { useState } from 'react';
import { Cloud, Loader2, Server, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DEFAULT_BACKEND_SERVER,
  DEFAULT_FRONTEND_SERVER,
  delay,
  type AppDevServerFormValues,
} from '@/components/app-dev/app-dev-deploy-defaults';
import { cn } from '@/lib/utils';

type CloudSection = 'frontend' | 'backend';

interface AppDevCloudPanelProps {
  workspaceId: string;
  appName: string;
}

function ServerFormFields({
  values,
  onChange,
  idPrefix,
}: {
  values: AppDevServerFormValues;
  onChange: (next: AppDevServerFormValues) => void;
  idPrefix: string;
}) {
  const set = (key: keyof AppDevServerFormValues, value: string) => {
    onChange({ ...values, [key]: value });
  };

  const fields: Array<{ key: keyof AppDevServerFormValues; label: string; type?: string }> = [
    { key: 'host', label: '主机地址' },
    { key: 'port', label: 'SSH 端口' },
    { key: 'username', label: '用户名' },
    { key: 'password', label: '密码', type: 'password' },
    { key: 'remotePath', label: '远端目录' },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <label key={field.key} className="space-y-1.5 sm:col-span-1" htmlFor={`${idPrefix}-${field.key}`}>
          <Label htmlFor={`${idPrefix}-${field.key}`} className="text-xs text-muted-foreground">
            {field.label}
          </Label>
          <Input
            id={`${idPrefix}-${field.key}`}
            type={field.type ?? 'text'}
            value={values[field.key]}
            onChange={(e) => set(field.key, e.target.value)}
            className="h-8 text-xs"
            autoComplete="off"
          />
        </label>
      ))}
    </div>
  );
}

export function AppDevCloudPanel({ workspaceId, appName }: AppDevCloudPanelProps) {
  const [section, setSection] = useState<CloudSection>('frontend');
  const [frontendServer, setFrontendServer] = useState(DEFAULT_FRONTEND_SERVER);
  const [backendServer, setBackendServer] = useState(DEFAULT_BACKEND_SERVER);
  const [frontendBusy, setFrontendBusy] = useState(false);
  const [backendBusy, setBackendBusy] = useState(false);
  const [frontendStep, setFrontendStep] = useState<string | null>(null);
  const [backendStep, setBackendStep] = useState<string | null>(null);

  const uploadFrontend = async () => {
    if (frontendBusy) return;
    setFrontendBusy(true);
    try {
      setFrontendStep('正在构建前端项目…');
      await delay(1200);
      setFrontendStep('正在打包 dist 产物…');
      await delay(800);
      setFrontendStep(`正在上传到 ${frontendServer.host}:${frontendServer.remotePath}…`);
      await delay(1100);
      toast.success('前端产物已上传（模拟）', {
        description: `${appName} → ${frontendServer.host}${frontendServer.remotePath}`,
      });
      setFrontendStep(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '前端上传失败');
      setFrontendStep(null);
    } finally {
      setFrontendBusy(false);
    }
  };

  const uploadBackend = async () => {
    if (backendBusy) return;
    setBackendBusy(true);
    try {
      setBackendStep('正在打包 Python 后端…');
      await delay(900);
      setBackendStep(`正在部署到 ${backendServer.host}:${backendServer.remotePath}…`);
      await delay(1100);
      toast.success('后端产物已部署（模拟）', {
        description: `${appName} → ${backendServer.host}${backendServer.remotePath}`,
      });
      setBackendStep(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '后端部署失败');
      setBackendStep(null);
    } finally {
      setBackendBusy(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto p-6">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Cloud className="h-4 w-4" aria-hidden />
            云服务
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            上传构建产物到云服务器。服务器信息暂为演示默认值；真实 SSH / 对象存储对接后续接入。
            <span className="ml-1 text-muted-foreground/80">workspace: {workspaceId}</span>
          </p>
        </header>

        <div className="inline-flex w-fit rounded-lg border border-border bg-muted/40 p-0.5">
          {(
            [
              { id: 'frontend', label: '上传前端产物' },
              { id: 'backend', label: '上传后端产物' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'h-7 rounded-md px-3 text-xs font-medium transition-colors',
                section === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-pressed={section === tab.id}
              onClick={() => setSection(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {section === 'frontend' ? (
          <section className="space-y-4 rounded-xl border border-border bg-background/70 p-4">
            <div className="flex items-start gap-2">
              <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <h3 className="text-sm font-medium text-foreground">前端产物</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  先执行前端构建，得到 dist 后再上传到服务器目录。
                </p>
              </div>
            </div>
            <ServerFormFields
              idPrefix="fe"
              values={frontendServer}
              onChange={setFrontendServer}
            />
            {frontendStep ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {frontendStep}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={frontendBusy}
                onClick={() => void uploadFrontend()}
              >
                {frontendBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                构建并上传
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={frontendBusy}
                onClick={() => setFrontendServer(DEFAULT_FRONTEND_SERVER)}
              >
                恢复默认服务器
              </Button>
            </div>
          </section>
        ) : (
          <section className="space-y-4 rounded-xl border border-border bg-background/70 p-4">
            <div className="flex items-start gap-2">
              <Server className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <h3 className="text-sm font-medium text-foreground">后端产物</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  将 Python 代码部署到目标服务器（当前为模拟流程）。
                </p>
              </div>
            </div>
            <ServerFormFields
              idPrefix="be"
              values={backendServer}
              onChange={setBackendServer}
            />
            {backendStep ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {backendStep}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={backendBusy}
                onClick={() => void uploadBackend()}
              >
                {backendBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden />
                )}
                部署 Python 代码
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={backendBusy}
                onClick={() => setBackendServer(DEFAULT_BACKEND_SERVER)}
              >
                恢复默认服务器
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
