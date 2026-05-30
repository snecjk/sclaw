import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function SkillPlazaHeader() {
  const { t } = useTranslation('skills');

  const handleOpenFolder = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { ipcRenderer } = window.electron as any;
      await ipcRenderer.invoke('open-skill-folder');
    } catch {
      // fallback: do nothing
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-4 mb-2">
      <div className="flex-1 min-w-0">
        <h1 className="text-[clamp(24px,2.8vw,30px)] font-bold text-foreground m-0">
          {t('plaza.title', { defaultValue: '技能广场' })}
        </h1>
        <p className="text-sm text-muted-foreground mt-2 mb-8 max-w-[560px]">
          {t('plaza.subtitle', { defaultValue: '管理你可以安装的技能，快速查看与使用' })}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={handleOpenFolder}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border-none bg-[#111] text-sm font-semibold text-white shadow-[0_2px_10px_rgba(0,0,0,0.15)] hover:brightness-110 transition-[filter] duration-150"
        >
          <FolderOpen className="h-4 w-4 flex-shrink-0" />
          {t('openFolder', { defaultValue: '打开技能文件夹' })}
        </button>
      </div>
    </div>
  );
}
