/**
 * Monaco editor for app-dev workbench source files.
 * Surfaces diagnostics and a "用 Agent 修复" action (banner + lightbulb).
 */
import { useEffect, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditorNs, IDisposable, MarkerSeverity as MarkerSeverityType } from 'monaco-editor';
import { ensureMonacoConfigured, languageFromPath } from '@/lib/monaco-setup';
import { useMonacoColorTheme } from '@/components/app-dev/use-monaco-theme';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Wand2 } from 'lucide-react';

export interface AppDevEditorDiagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

interface AppDevMonacoEditorProps {
  filePath: string;
  value: string;
  onChange: (next: string) => void;
  /** Fill chat composer with formatted diagnostics (do not auto-send). */
  onFixWithAgent?: (diagnostics: AppDevEditorDiagnostic[], filePath: string) => void;
  className?: string;
}

const FIX_ACTION_ID = 'sclaw.appDev.fixWithAgent';

function severityLabel(
  severity: MarkerSeverityType,
  MarkerSeverity: typeof import('monaco-editor').MarkerSeverity,
): AppDevEditorDiagnostic['severity'] {
  if (severity === MarkerSeverity.Error) return 'error';
  if (severity === MarkerSeverity.Warning) return 'warning';
  if (severity === MarkerSeverity.Info) return 'info';
  return 'hint';
}

function markersToDiagnostics(
  markers: MonacoEditorNs.IMarker[],
  MarkerSeverity: typeof import('monaco-editor').MarkerSeverity,
): AppDevEditorDiagnostic[] {
  return markers
    .filter((m) => m.severity === MarkerSeverity.Error || m.severity === MarkerSeverity.Warning)
    .map((m) => ({
      line: m.startLineNumber,
      column: m.startColumn,
      severity: severityLabel(m.severity, MarkerSeverity),
      message: m.message,
      source: m.source,
    }));
}

export function formatAppDevDiagnosticsPrompt(
  filePath: string,
  diagnostics: AppDevEditorDiagnostic[],
): string {
  const lines = diagnostics.slice(0, 20).map((d) => {
    const tag = d.severity === 'error' ? '错误' : '警告';
    return `- [${tag}] L${d.line}:${d.column} ${d.message}`;
  });
  return [
    '请帮我修复当前编辑器中的代码问题：',
    '',
    `文件：${filePath}`,
    '',
    ...lines,
  ].join('\n');
}

export function AppDevMonacoEditor({
  filePath,
  value,
  onChange,
  onFixWithAgent,
  className,
}: AppDevMonacoEditorProps) {
  const theme = useMonacoColorTheme();
  const [ready, setReady] = useState(false);
  const [diagnostics, setDiagnostics] = useState<AppDevEditorDiagnostic[]>([]);
  const editorRef = useRef<MonacoEditorNs.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const onFixRef = useRef(onFixWithAgent);
  onFixRef.current = onFixWithAgent;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  useEffect(() => {
    ensureMonacoConfigured();
    setReady(true);
  }, []);

  useEffect(() => {
    setDiagnostics([]);
  }, [filePath]);

  const refreshMarkers = () => {
    const monacoApi = monacoRef.current;
    const ed = editorRef.current;
    if (!monacoApi || !ed) return;
    const model = ed.getModel();
    if (!model) {
      setDiagnostics([]);
      return;
    }
    let markers = monacoApi.editor.getModelMarkers({ resource: model.uri });
    if (markers.length === 0) {
      const modelUri = model.uri.toString();
      markers = monacoApi.editor
        .getModelMarkers({})
        .filter((m) => m.resource.toString() === modelUri);
    }
    setDiagnostics(markersToDiagnostics(markers, monacoApi.MarkerSeverity));
  };

  const handleFixClick = () => {
    if (diagnostics.length === 0) return;
    onFixRef.current?.(diagnostics, filePathRef.current);
  };

  const handleMount: OnMount = (ed, monacoApi) => {
    editorRef.current = ed;
    monacoRef.current = monacoApi;

    const disposables: IDisposable[] = [];

    disposables.push(
      monacoApi.editor.onDidChangeMarkers(() => {
        refreshMarkers();
      }),
    );

    disposables.push(
      ed.onDidChangeModelContent(() => {
        window.setTimeout(refreshMarkers, 200);
      }),
    );

    disposables.push(
      ed.onDidChangeModel(() => {
        window.setTimeout(refreshMarkers, 300);
      }),
    );

    disposables.push(
      ed.addAction({
        id: `${FIX_ACTION_ID}.editor`,
        label: '用 Agent 修复',
        keybindings: [
          monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyD,
        ],
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.5,
        run: () => {
          // Keyboard / context-menu: only issues on the current line.
          const model = ed.getModel();
          const position = ed.getPosition();
          if (!model || !position) return;
          const markers = monacoApi.editor
            .getModelMarkers({ resource: model.uri })
            .filter(
              (m) => (m.severity === monacoApi.MarkerSeverity.Error
                || m.severity === monacoApi.MarkerSeverity.Warning)
                && m.startLineNumber <= position.lineNumber
                && m.endLineNumber >= position.lineNumber,
            );
          const next = markersToDiagnostics(markers, monacoApi.MarkerSeverity);
          if (next.length === 0) return;
          onFixRef.current?.(next, filePathRef.current);
        },
      }),
    );

    disposables.push(
      // Lightbulb / line quick-fix: only the markers for that range (args[0]).
      monacoApi.editor.registerCommand(FIX_ACTION_ID, (_accessor, diagnosticsArg?: AppDevEditorDiagnostic[]) => {
        const scoped = Array.isArray(diagnosticsArg) ? diagnosticsArg : null;
        if (scoped && scoped.length > 0) {
          onFixRef.current?.(scoped, filePathRef.current);
          return;
        }
        // Fallback (should be rare): current-line markers only.
        const model = ed.getModel();
        const position = ed.getPosition();
        if (!model || !position) return;
        const markers = monacoApi.editor
          .getModelMarkers({ resource: model.uri })
          .filter(
            (m) => (m.severity === monacoApi.MarkerSeverity.Error
              || m.severity === monacoApi.MarkerSeverity.Warning)
              && m.startLineNumber <= position.lineNumber
              && m.endLineNumber >= position.lineNumber,
          );
        const next = markersToDiagnostics(markers, monacoApi.MarkerSeverity);
        if (next.length === 0) return;
        onFixRef.current?.(next, filePathRef.current);
      }),
    );

    disposables.push(
      monacoApi.languages.registerCodeActionProvider(
        ['typescript', 'javascript', 'json', 'css', 'html'],
        {
          provideCodeActions(_model, _range, context) {
            const relevant = context.markers.filter(
              (m) => m.severity === monacoApi.MarkerSeverity.Error
                || m.severity === monacoApi.MarkerSeverity.Warning,
            );
            if (relevant.length === 0 || !onFixRef.current) {
              return { actions: [], dispose: () => undefined };
            }
            const scoped = markersToDiagnostics(relevant, monacoApi.MarkerSeverity);
            return {
              actions: [
                {
                  title: scoped.length === 1
                    ? '用 Agent 修复此问题'
                    : `用 Agent 修复这 ${scoped.length} 个问题`,
                  kind: 'quickfix',
                  isPreferred: true,
                  command: {
                    id: FIX_ACTION_ID,
                    title: '用 Agent 修复',
                    arguments: [scoped],
                  },
                },
              ],
              dispose: () => undefined,
            };
          },
        },
      ),
    );

    // Markers from the TS worker can arrive after mount; poll briefly.
    refreshMarkers();
    const poll = window.setInterval(refreshMarkers, 800);
    disposables.push({ dispose: () => window.clearInterval(poll) });

    ed.onDidDispose(() => {
      for (const d of disposables) d.dispose();
      if (editorRef.current === ed) editorRef.current = null;
    });
  };

  if (!ready) {
    return (
      <div className={cn('flex h-full items-center justify-center text-sm text-muted-foreground', className)}>
        正在加载编辑器…
      </div>
    );
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col overflow-hidden', className)}>
      {onFixWithAgent ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/40 px-3 py-1.5">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {diagnostics.length > 0 ? (
              <>
                {errorCount > 0 ? `${errorCount} 个错误` : null}
                {errorCount > 0 && warningCount > 0 ? ' · ' : null}
                {warningCount > 0 ? `${warningCount} 个警告` : null}
                <span className="ml-2 text-muted-foreground/80">可一键填入右侧会话</span>
              </>
            ) : (
              <span>当前文件暂无诊断问题</span>
            )}
          </p>
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-7 shrink-0 gap-1 px-2.5 text-xs"
            disabled={diagnostics.length === 0}
            onClick={handleFixClick}
          >
            <Wand2 className="h-3.5 w-3.5" aria-hidden />
            用 Agent 修复
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Editor
          path={filePath}
          language={languageFromPath(filePath)}
          value={value}
          theme={theme}
          onMount={handleMount}
          onChange={(next) => onChange(next ?? '')}
          options={{
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            tabSize: 2,
            renderLineHighlight: 'line',
            padding: { top: 8, bottom: 8 },
            lightbulb: { enabled: true },
            codeActionsOnSaveTimeout: 750,
          }}
          loading={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              正在加载编辑器…
            </div>
          }
        />
      </div>
    </div>
  );
}
