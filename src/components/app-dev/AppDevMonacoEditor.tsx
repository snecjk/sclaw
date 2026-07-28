/**
 * Monaco editor for app-dev workbench source files.
 */
import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { ensureMonacoConfigured, languageFromPath } from '@/lib/monaco-setup';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';

interface AppDevMonacoEditorProps {
  filePath: string;
  value: string;
  onChange: (next: string) => void;
  className?: string;
}

export function AppDevMonacoEditor({
  filePath,
  value,
  onChange,
  className,
}: AppDevMonacoEditorProps) {
  const theme = useSettingsStore((s) => s.theme);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureMonacoConfigured();
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className={cn('flex h-full items-center justify-center text-sm text-muted-foreground', className)}>
        正在加载编辑器…
      </div>
    );
  }

  return (
    <div className={cn('h-full min-h-0 w-full overflow-hidden', className)}>
      <Editor
        path={filePath}
        language={languageFromPath(filePath)}
        value={value}
        theme={
          theme === 'dark'
          || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
            ? 'vs-dark'
            : 'light'
        }
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
        }}
        loading={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            正在加载编辑器…
          </div>
        }
      />
    </div>
  );
}
