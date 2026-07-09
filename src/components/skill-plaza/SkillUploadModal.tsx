import { useState } from 'react';
import { X, CheckCircle2, AlertCircle, FileArchive, FileUp } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { SkillSummary } from '@/types/skill-plaza';

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface SkillUploadModalProps {
  open: boolean;
  onClose: () => void;
}

type UploadStatus = 'idle' | 'preview' | 'uploading' | 'success' | 'error';

export function SkillUploadModal({ open, onClose }: SkillUploadModalProps) {
  const { t } = useTranslation('skills');
  const uploadSkill = useSkillPlazaStore((s) => s.uploadSkill);
  const mySkills = useSkillPlazaStore((s) => s.mySkills);
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number>(0);
  const [slug, setSlug] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Reset to a fresh state every time the modal opens. Uses React's
  // "adjust state when a prop changes" pattern (setState during render is
  // blessed here) to avoid calling setState inside an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStatus('idle');
      setFilePath(null);
      setFileName(null);
      setFileSize(0);
      setSlug(null);
      setErrorMsg(null);
      setDragOver(false);
    }
  }

  const resetToIdle = () => {
    setStatus('idle');
    setFilePath(null);
    setFileName(null);
    setFileSize(0);
    setSlug(null);
    setErrorMsg(null);
  };

  // Enter the preview/confirm step with the given local path. Does NOT start
  // uploading until the user confirms — required by the preview-confirm step.
 const enterPreview = (selectedPath: string) => {
   setFilePath(selectedPath);
   setFileName(selectedPath.split(/[\\/]/).pop() || selectedPath);
   setErrorMsg(null);
   setStatus('preview');
    // Fetch file size via /api/files/thumbnails (returns fileSize from fs.stat).
    // Best-effort: the preview card shows '-' if the size cannot be read.
    void (async () => {
      try {
        const res = await hostApiFetch<Record<string, { preview: string | null; fileSize: number }>>(
          '/api/files/thumbnails',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paths: [{ filePath: selectedPath, mimeType: 'application/zip' }],
            }),
          },
        );
        const size = res?.[selectedPath]?.fileSize;
        if (typeof size === 'number') setFileSize(size);
      } catch {
        // ignore
      }
    })();
 };

  // Step 1 (option A): pick a local .zip file OR folder via the native dialog.
  // `openFile` + `openDirectory` lets the user pick either; the ZIP filter only
  // restricts files (folders remain selectable).
  const pickFile = async () => {
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths: string[] }>(
        'dialog:open',
        {
          title: t('plaza.upload.title', { defaultValue: '上传技能' }),
          properties: ['openFile', 'openDirectory'],
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        },
      );
      if (result.canceled || !result.filePaths?.length) return;
      enterPreview(result.filePaths[0]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  // Step 1 (option B): drag & drop. Electron removed the non-standard
  // `File.path` field in v36+; paths must be resolved via `webUtils.getPathForFile`,
  // which the preload exposes as `window.electron.getPathForFile` (the renderer
  // runs with nodeIntegration:false and cannot read paths itself). Works for
  // both files and directories — probe DataTransferItem first (folder drops
  // may only surface there), then fall back to the FileList.
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dt = e.dataTransfer;
    if (!dt) return;
    let droppedPath: string | null = null;
    // Resolve a real path from a File using the preload-exposed webUtils.
    const pathOf = (f: File | null | undefined): string | null => {
      if (!f) return null;
      try {
        const p = window.electron.getPathForFile(f);
        return typeof p === 'string' && p ? p : null;
      } catch {
        return null;
      }
    };
    // Probe DataTransferItemList first (folder drops may only surface here).
    // Access items synchronously during the drop event — Chromium clears
    // the list once the event loop yields.
    if (dt.items && dt.items.length) {
      for (const item of Array.from(dt.items)) {
        if (item.kind !== 'file') continue;
        const p = pathOf(item.getAsFile());
        if (p) {
          droppedPath = p;
          break;
        }
      }
    }
    if (!droppedPath && dt.files && dt.files.length) {
      const p = pathOf(dt.files[0]);
      if (p) droppedPath = p;
    }
    if (droppedPath) {
      enterPreview(droppedPath);
    } else {
      setErrorMsg(
        t('plaza.upload.dragFailed', {
          defaultValue: '无法获取拖入项的路径,请改用"选择文件/文件夹"',
        }),
      );
      setStatus('error');
    }
  };

  // Step 2: confirm and upload.
  const confirmUpload = async () => {
    if (!filePath) return;
    setStatus('uploading');
    setErrorMsg(null);
    try {
      const resultSlug = await uploadSkill(filePath);
      setSlug(resultSlug);
      setStatus('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  // "查看技能": jump to the "我的技能" tab where the uploaded skill appears.
  const handleViewSkill = () => {
    useSkillPlazaStore.getState().setActiveTab('mine');
    onClose();
  };

  // The store refreshes mySkills after upload, so look up the skill by slug
  // to enrich the success card (icon / title / category tag).
  const uploadedSkill: SkillSummary | undefined = slug
    ? mySkills.find((s) => s.slug === slug)
    : undefined;
  const skillTitle = uploadedSkill?.title || slug || '';
  const skillCategoryCode = uploadedSkill?.categoryCode;

  const renderSkillIcon = () => {
    if (uploadedSkill?.icon) {
      return (
        <span
          dangerouslySetInnerHTML={{
            __html: uploadedSkill.icon
              .replace(/width="[^"]*"/, 'width="20"')
              .replace(/height="[^"]*"/, 'height="20"'),
          }}
        />
      );
    }
    return <span className="text-lg">📦</span>;
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 dark:bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-full max-w-[420px]',
            'bg-background rounded-2xl shadow-2xl',
            'flex flex-col overflow-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          {/* Close button */}
          <Dialog.Close asChild>
            <button
              onClick={onClose}
              className="absolute right-4 top-4 h-7 w-7 inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Dialog.Close>

          <div className="p-6">
            <h2 className="text-base font-semibold text-foreground pr-8">
              {t('plaza.upload.title', { defaultValue: '上传技能' })}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {t('plaza.upload.subtitle', { defaultValue: '· 文件夹或.zip需要包含SKILL.MD文件' })}
              <br />
              {t('plaza.upload.subtitle', { defaultValue: '· .MD文件需要包含YAML格式的技能名和描述'})}
            </p>

            <div className="mt-5">
              {status === 'idle' && (
                <div
                  role="button"
                  tabIndex={0}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={pickFile}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      pickFile();
                    }
                  }}
                  className={cn(
                    'flex flex-col items-center text-center w-full py-10 px-4 rounded-xl border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    dragOver
                      ? 'border-[#00B54B] bg-[#00B54B]/10'
                      : 'border-[#C9CDD4] bg-[#FAFBFC] hover:border-[#00B54B] hover:bg-[#00B54B]/5',
                  )}
                >
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <FileArchive className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {t('plaza.upload.dragHint', { defaultValue: '点击文件夹、.zip 文件到此处' })}
                  </p>
                  <ul className="text-xs text-muted-foreground mt-4 space-y-1 text-left">
                    {/*<li>{t('plaza.upload.requirementSkillMd', { defaultValue: '文件夹或 .zip 需包含 SKILL.md 文件' })}</li>*/}
                    {/*<li>{t('plaza.upload.requirementYaml', { defaultValue: 'SKILL.md 需含 YAML 格式的 name 与 description' })}</li>*/}
                  </ul>
                </div>
              )}

              {status === 'preview' && (
                <div className="flex flex-col items-center text-center py-4">
                  {/* Compact file card: file name + size only */}
                  <div className="w-full flex items-center gap-3 rounded-xl border border-[#E6FFEA] bg-[#F5FCF6] px-4 py-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#DCF5E2] flex-shrink-0">
                      <FileArchive className="h-4 w-4 text-[#00B54B]" />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-medium text-foreground break-all line-clamp-1">
                        {fileName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatFileSize(fileSize)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={pickFile}
                      className="inline-flex items-center h-9 px-4 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {t('plaza.upload.reselect', { defaultValue: '重新选择' })}
                    </button>
                    <button
                      type="button"
                      onClick={confirmUpload}
                      className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      <FileUp className="h-4 w-4" />
                      {t('plaza.upload.confirmUpload', { defaultValue: '安装' })}
                    </button>
                  </div>
                </div>
              )}

              {status === 'uploading' && (
                <div className="flex flex-col items-center text-center py-6">
                  <span className="animate-spin h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full mb-3" />
                  <p className="text-sm text-foreground">
                    {t('plaza.upload.uploading', { defaultValue: '安装...' })}
                  </p>
                </div>
              )}

              {status === 'success' && (
                <div className="flex flex-col items-center text-center py-4">
                  {/* Success banner: check icon + title on #E6FFEA panel */}
                  <div
                    className="w-full rounded-xl px-4 py-5 flex flex-col items-center"
                    style={{ background: '#E6FFEA' }}
                  >
                    <div className="w-12 h-12 rounded-full bg-[#DCF5E2] flex items-center justify-center mb-3">
                      <CheckCircle2 className="h-6 w-6 text-[#00B54B]" />
                    </div>
                    <p className="text-sm font-medium text-foreground">
                      {t('plaza.upload.successTitle', { defaultValue: '安装成功' })}
                    </p>
                  </div>
                  {/* Skill card: icon + name + category tag */}
                  <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg bg-muted/60 w-full justify-center">
                    <div className="w-7 h-7 rounded flex items-center justify-center bg-background border border-border flex-shrink-0">
                      {renderSkillIcon()}
                    </div>
                    <span className="text-sm font-medium text-foreground break-all line-clamp-1">
                      {skillTitle}
                    </span>
                    {skillCategoryCode && (
                      <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium bg-[#F0F4FF] text-[#4760FE] flex-shrink-0">
                        {t(`plaza.category.${skillCategoryCode}`, { defaultValue: skillCategoryCode })}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('plaza.upload.successHint', { defaultValue: '关闭后可在技能广场列表查看' })}
                  </p>
                  <div className="flex gap-2 mt-5 w-full">
                    <button
                      type="button"
                      onClick={resetToIdle}
                      className="flex-1 inline-flex items-center justify-center h-9 px-4 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {t('plaza.upload.uploadAnother', { defaultValue: '继续安装' })}
                    </button>
                    <button
                      type="button"
                      onClick={handleViewSkill}
                      className="flex-1 inline-flex items-center justify-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      {t('plaza.upload.viewSkill', { defaultValue: '查看技能' })}
                    </button>
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="flex flex-col items-center text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-[#FFE9E9] flex items-center justify-center mb-3">
                    <AlertCircle className="h-6 w-6 text-[#E53935]" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {t('plaza.upload.errorTitle', { defaultValue: '安装失败' })}
                  </p>
                  {errorMsg && (
                    <p className="text-xs text-muted-foreground mt-1 break-all">{errorMsg}</p>
                  )}
                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={pickFile}
                      className="inline-flex items-center h-9 px-4 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {t('plaza.upload.retry', { defaultValue: '重新选择' })}
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="inline-flex items-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      {t('plaza.upload.close', { defaultValue: '关闭' })}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
