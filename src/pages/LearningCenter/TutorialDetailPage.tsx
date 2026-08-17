import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { TutorialViewer } from '@/components/learning-center/TutorialViewer';
import { getTutorialDetail, LearningCenterApiError, type TutorialDetail } from '@/lib/learning-center-api';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; tutorial: TutorialDetail }
  | { status: 'forbidden'; message: string }
  | { status: 'error'; message: string };

export function TutorialDetailPage() {
  const navigate = useNavigate();
  const { tutorialId = '' } = useParams();
  const hasValidId = /^\d+$/.test(tutorialId) && tutorialId !== '0';
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<LoadState>(hasValidId
    ? { status: 'loading' }
    : { status: 'error', message: '教程地址无效' });

  useEffect(() => {
    let active = true;
    if (!hasValidId) {
      return () => { active = false; };
    }
    getTutorialDetail(tutorialId).then((tutorial) => {
      if (active) setState({ status: 'ready', tutorial });
    }).catch((error: unknown) => {
      if (!active) return;
      const forbidden = error instanceof LearningCenterApiError && error.code === '403';
      setState({
        status: forbidden ? 'forbidden' : 'error',
        message: error instanceof Error ? error.message : '教程加载失败',
      });
    });
    return () => { active = false; };
  }, [hasValidId, reloadKey, tutorialId]);

  return <main className="h-full overflow-y-auto bg-background px-6 py-5">
    <div className="mx-auto max-w-4xl">
      <button type="button" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-4 w-4" />返回
      </button>
      {state.status === 'loading' && <div className="rounded-xl border p-10 text-center text-muted-foreground">教程加载中…</div>}
      {state.status === 'forbidden' && <div role="alert" className="rounded-xl border p-10 text-center">
        <h1 className="text-lg font-semibold">暂无查看权限</h1><p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
      </div>}
      {state.status === 'error' && <div role="alert" className="rounded-xl border p-10 text-center">
        <h1 className="text-lg font-semibold">教程加载失败</h1><p className="mt-2 text-sm text-muted-foreground">{state.message}</p>
        <button type="button" className="mt-4 inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm" onClick={() => {
          setState({ status: 'loading' });
          setReloadKey((value) => value + 1);
        }}>
          <RefreshCw className="h-4 w-4" />重新加载
        </button>
      </div>}
      {state.status === 'ready' && <section className="rounded-xl border bg-card p-6 shadow-sm">
        <header className="mb-6 border-b pb-5">
          <h1 className="text-2xl font-bold">{state.tutorial.title}</h1>
          {state.tutorial.subTitle && <p className="mt-2 text-sm text-muted-foreground">{state.tutorial.subTitle}</p>}
          {state.tutorial.description && <p className="mt-3 text-sm text-muted-foreground">{state.tutorial.description}</p>}
        </header>
        <TutorialViewer html={state.tutorial.content ?? ''} />
      </section>}
    </div>
  </main>;
}
