/**
 * AddExternalAppModal — modal for installing / editing external apps
 */
import { useState, FormEvent, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useMoreAppsStore } from '@/stores/more-apps';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function AddExternalAppModal() {
  const { t } = useTranslation('common');
  const {
    addModalOpen,
    editingExternalAppId,
    externalApps,
    closeAddModal,
    addExternalApp,
    updateExternalApp,
  } = useMoreAppsStore();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');

  const isEditing = editingExternalAppId !== null;
  const editingApp = isEditing
    ? externalApps.find((a) => a.id === editingExternalAppId)
    : undefined;

  useEffect(() => {
    if (!addModalOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the modal clears its local draft.
      setName('');
      setUrl('');
      setDesc('');
      setError('');
      return;
    }
    if (editingApp) {
      setName(editingApp.name);
      setUrl(editingApp.url);
      setDesc(editingApp.description === '外部应用链接' ? '' : (editingApp.description ?? ''));
      setError('');
    } else if (!isEditing) {
      setName('');
      setUrl('');
      setDesc('');
      setError('');
    }
  }, [addModalOpen, editingApp, isEditing]);

  if (!addModalOpen) return null;

  // Render beside the app layout instead of inside the main content card.
  // This keeps the fixed overlay out of the card's clipping/stacking boundary,
  // so sidebar sticky headers cannot paint above the backdrop.
  const portalTarget =
    document.querySelector<HTMLElement>('[data-app-shell]') ?? document.body;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!name.trim()) {
      setError(t('moreApps.addModal.errorName', { defaultValue: '请输入应用名称' }));
      return;
    }
    if (!trimmedUrl) {
      setError(t('moreApps.addModal.errorUrl', { defaultValue: '请输入应用地址' }));
      return;
    }
    try {
      new URL(trimmedUrl);
    } catch {
      setError(t('moreApps.addModal.errorUrlFormat', { defaultValue: '应用地址格式不正确，请输入完整 URL' }));
      return;
    }
    setError('');
    const payload = { name, url: trimmedUrl, description: desc };
    if (isEditing && editingExternalAppId) {
      updateExternalApp(editingExternalAppId, payload);
      toast.success(t('moreApps.toast.updated', { defaultValue: '应用已更新' }), { duration: 2000 });
      return;
    }
    addExternalApp(payload);
    setName('');
    setUrl('');
    setDesc('');
  };

  return createPortal(
    <div className="page-more-apps more-apps-modal" hidden={!addModalOpen}>
      <div
        className="sto-overlay-scrim sto-overlay-scrim--dialog more-apps-modal__backdrop"
        onClick={closeAddModal}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="more-apps-add-modal-title"
        className="sto-overlay sto-overlay--raised-dialog more-apps-modal__panel"
      >
        <div className="more-apps-modal__head">
          <h2 id="more-apps-add-modal-title" className="more-apps-modal__title">
            {isEditing
              ? t('moreApps.editModal.title', { defaultValue: '编辑外部应用' })
              : t('moreApps.addModal.title', { defaultValue: '安装外部应用' })}
          </h2>
          <button
            type="button"
            onClick={closeAddModal}
            className="sto-control sto-control--dismiss more-apps-modal__close"
            aria-label={t('common.close', { defaultValue: '关闭' })}
            data-more-apps-modal-close
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <label className="more-apps-modal__field">
            <span className="more-apps-modal__label">
              {t('moreApps.addModal.nameLabel', { defaultValue: '应用名称' })}
            </span>
            <input
              type="text"
              className="sto-control sto-control--dialog-field more-apps-modal__input"
              placeholder={t('moreApps.addModal.namePlaceholder', { defaultValue: '例如：网点 OA 系统' })}
              maxLength={40}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="more-apps-modal__field">
            <span className="more-apps-modal__label">
              {t('moreApps.addModal.urlLabel', { defaultValue: '应用地址' })}
            </span>
            <input
              type="url"
              className="sto-control sto-control--dialog-field more-apps-modal__input"
              placeholder="https://example.com/app"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <label className="more-apps-modal__field">
            <span className="more-apps-modal__label">
              {t('moreApps.addModal.descLabel', { defaultValue: '应用说明（选填）' })}
            </span>
            <textarea
              className="sto-control sto-control--dialog-field more-apps-modal__textarea"
              rows={3}
              maxLength={120}
              placeholder={t('moreApps.addModal.descPlaceholder', { defaultValue: '简要说明该外部应用的用途' })}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </label>
          {error && (
            <p className="m-0 text-xs text-red-500 mb-4">{error}</p>
          )}
          <p className="more-apps-modal__hint">
            {t('moreApps.addModal.hint', { defaultValue: '外部应用将在应用内嵌打开，链接保存在本浏览器本地' })}
          </p>
          <div className="more-apps-modal__actions">
            <button
              type="button"
              onClick={closeAddModal}
              className={cn('sto-control sto-control--dialog-secondary', 'more-apps-modal__btn', 'more-apps-modal__btn--ghost')}
            >
              {t('common.cancel', { defaultValue: '取消' })}
            </button>
            <button
              type="submit"
              className={cn('sto-control sto-control--dialog-primary', 'more-apps-modal__btn', 'more-apps-modal__btn--primary')}
            >
              {isEditing
                ? t('moreApps.editModal.save', { defaultValue: '保存' })
                : t('moreApps.addModal.install', { defaultValue: '安装' })}
            </button>
          </div>
        </form>
      </div>
    </div>,
    portalTarget,
  );
}
