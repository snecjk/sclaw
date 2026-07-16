import { FolderOpen, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { stoPageTitleClass } from '@/lib/surfaces';
import { useState } from 'react';
import { SkillUploadModal } from './SkillUploadModal';

interface SkillPlazaHeaderProps {
  onUploadSuccess?: () => void;
}

export function SkillPlazaHeader({ onUploadSuccess }: SkillPlazaHeaderProps) {
  const { t } = useTranslation('skills');
  const [uploadOpen, setUploadOpen] = useState(false);

  const handleOpenFolder = async () => {
    try {
      await invokeIpc('open-skill-folder');
    } catch {
      // fallback: do nothing
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-4 mb-2">
      <div className="flex-1 min-w-0">
        <h1 className={stoPageTitleClass}>
          {t('plaza.title', { defaultValue: '技能广场' })}
        </h1>
        <p className="text-sm text-muted-foreground mt-2 mb-8 max-w-[560px]">
          {t('plaza.subtitle', { defaultValue: '管理你可以安装的技能，快速查看与使用' })}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border-none bg-primary text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors duration-150"
        >
          <Upload className="h-4 w-4 flex-shrink-0" />
          {t('plaza.upload.button', { defaultValue: '上传技能' })}
        </button>
        <button
          type="button"
          onClick={handleOpenFolder}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border-none bg-primary text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors duration-150"
        >
          <FolderOpen className="h-4 w-4 flex-shrink-0" />
          {t('openFolder', { defaultValue: '打开技能文件夹' })}
        </button>
      </div>

      <SkillUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploadSuccess={onUploadSuccess}
      />
    </div>
  );
}
