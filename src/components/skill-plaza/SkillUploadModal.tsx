import { useState } from 'react';
import { X, Upload, CheckCircle2, AlertCircle, FileArchive, FileUp } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { invokeIpc } from '@/lib/api-client';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { SkillSummary } from '@/types/skill-plaza';

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
  const [slug, setSlug] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
      setSlug(null);
      setErrorMsg(null);
    }
  }

  const resetToIdle = () => {
    setStatus('idle');
    setFilePath(null);
    setFileName(null);
    setSlug(null);
    setErrorMsg(null);
  };

  // Step 1: pick a local .zip via the native file dialog, then enter the
  // preview/confirm state. Does NOT start uploading until the user confirms.
  const pickFile = async () => {
    try {
      const result = await invokeIpc<{ canceled: boolean; filePaths: string[] }>(
        'dialog:open',
        {
          title: t('plaza.upload.title', { defaultValue: '上传技能' }),
          properties: ['openFile'],
          filters: [{ name: 'ZIP', extensions: ['zip'] }],
        },
      );
      if (result.canceled || !result.filePaths?.length) return;
      const selected = result.filePaths[0];
      setFilePath(selected);
      setFileName(selected.split(/[\\/]/).pop() || selected);
      setErrorMsg(null);
      setStatus('preview');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
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
              {t('plaza.upload.subtitle', { defaultValue: '拖拽或选择本地文件夹 / .zip 文件上传到我的技能' })}
            </p>

            <div className="mt-5">
              {status === 'idle' && (
                <div className="flex flex-col items-center text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <FileArchive className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <button
                    type="button"
                    onClick={pickFile}
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Upload className="h-4 w-4" />
                    {t('plaza.upload.selectFile', { defaultValue: '选择 ZIP 文件' })}
                  </button>
                  <ul className="text-xs text-muted-foreground mt-3 space-y-1 text-left">
                    <li>{t('plaza.upload.requirementSkillMd', { defaultValue: '文件夹或 .zip 需包含 SKILL.md 文件' })}</li>
                    <li>{t('plaza.upload.requirementYaml', { defaultValue: 'SKILL.md 需含 YAML 格式的 name 与 description' })}</li>
                  </ul>
                </div>
              )}

              {status === 'preview' && (
                <div className="flex flex-col items-center text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                    <FileArchive className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground mb-1">
                    {t('plaza.upload.selectedFile', { defaultValue: '已选择文件' })}
                  </p>
                  <p className="text-sm font-medium text-foreground break-all">{fileName}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {t('plaza.upload.confirmHint', { defaultValue: '确认后将解压并导入到技能广场' })}
                  </p>
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
                      {t('plaza.upload.confirmUpload', { defaultValue: '确认上传' })}
                    </button>
                  </div>
                </div>
              )}

              {status === 'uploading' && (
                <div className="flex flex-col items-center text-center py-6">
                  <span className="animate-spin h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full mb-3" />
                  <p className="text-sm text-foreground">
                    {t('plaza.upload.uploading', { defaultValue: '上传中...' })}
                  </p>
                </div>
              )}

              {status === 'success' && (
                <div className="flex flex-col items-center text-center py-4">
                  <div className="w-12 h-12 rounded-full bg-[#DCF5E2] flex items-center justify-center mb-3">
                    <CheckCircle2 className="h-6 w-6 text-[#00B54B]" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {t('plaza.upload.successTitle', { defaultValue: '上传成功' })}
                  </p>
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
                  <div className="flex gap-2 mt-5">
                    <button
                      type="button"
                      onClick={resetToIdle}
                      className="inline-flex items-center h-9 px-4 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                      {t('plaza.upload.uploadAnother', { defaultValue: '继续上传' })}
                    </button>
                    <button
                      type="button"
                      onClick={handleViewSkill}
                      className="inline-flex items-center h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
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
                    {t('plaza.upload.errorTitle', { defaultValue: '上传失败' })}
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
