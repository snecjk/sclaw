/**
 * AddExternalAppModal — modal for installing external apps
 * Aligned with the PRD demo (more-apps.css)
 */
import { useState, FormEvent } from 'react';
import { useMoreAppsStore } from '@/stores/more-apps';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function AddExternalAppModal() {
  const { t } = useTranslation('common');
  const { addModalOpen, closeAddModal, addExternalApp } = useMoreAppsStore();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');

  if (!addModalOpen) return null;

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
      // Validate URL
      new URL(trimmedUrl);
    } catch {
      setError(t('moreApps.addModal.errorUrlFormat', { defaultValue: '应用地址格式不正确，请输入完整 URL' }));
      return;
    }
    setError('');
    addExternalApp({ name, url: trimmedUrl, description: desc });
    setName('');
    setUrl('');
    setDesc('');
  };

  return (
    <div className="more-apps-modal" hidden={!addModalOpen}>
      {/* Backdrop */}
      <div
        className="more-apps-modal__backdrop"
        onClick={closeAddModal}
        aria-hidden
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="more-apps-add-modal-title"
        className="more-apps-modal__panel"
      >
        {/* Head */}
        <div className="more-apps-modal__head">
          <h2 id="more-apps-add-modal-title" className="more-apps-modal__title">
            {t('moreApps.addModal.title', { defaultValue: '安装外部应用' })}
          </h2>
          <button
            type="button"
            onClick={closeAddModal}
            className="more-apps-modal__close"
            aria-label={t('common.close', { defaultValue: '关闭' })}
            data-more-apps-modal-close
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {/* Form */}
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <label className="more-apps-modal__field">
            <span className="more-apps-modal__label">
              {t('moreApps.addModal.nameLabel', { defaultValue: '应用名称' })}
            </span>
            <input
              type="text"
              className="more-apps-modal__input"
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
              className="more-apps-modal__input"
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
              className="more-apps-modal__textarea"
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
          {/* Actions */}
          <div className="more-apps-modal__actions">
            <button
              type="button"
              onClick={closeAddModal}
              className={cn('more-apps-modal__btn', 'more-apps-modal__btn--ghost')}
            >
              {t('common.cancel', { defaultValue: '取消' })}
            </button>
            <button
              type="submit"
              className={cn('more-apps-modal__btn', 'more-apps-modal__btn--primary')}
            >
              {t('moreApps.addModal.install', { defaultValue: '安装' })}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
