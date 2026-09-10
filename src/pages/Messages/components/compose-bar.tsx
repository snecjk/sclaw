import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InputComposerSendButton } from '@/components/input-composer/input-composer-send-button';
import { InputComposerShell } from '@/components/input-composer/input-composer-shell';
import { cn } from '@/lib/utils';
import { isImRichHtmlEmpty } from '@/lib/openim/im-rich-html';
import { ComposeToolbarLeft } from './compose-action-bar';
import { ImRichEditor, type ImRichEditorHandle } from './im-rich-editor';
import { ImRichFormatToolbar } from './im-rich-format-toolbar';
import { messagesConversationInsetClass } from './messages-conversation-inset';

export function ComposeBar({
  disabled,
  showAgentAction,
  onSendArtifact,
  onSendRichHtml,
  onPickImageFiles,
}: {
  disabled?: boolean;
  showAgentAction?: boolean;
  onSendArtifact: () => void;
  onSendRichHtml?: (html: string, blobFiles: Map<string, File>) => void | Promise<void>;
  /** Open file dialog and return image/file paths or File list for insert. */
  onPickImageFiles?: () => Promise<Array<File | string>>;
}) {
  const { t } = useTranslation('common');
  const editorRef = useRef<ImRichEditorHandle>(null);
  const [formatOpen, setFormatOpen] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const [sending, setSending] = useState(false);

  const refreshCanSend = useCallback(() => {
    setCanSend(!editorRef.current?.isEmpty());
  }, []);

  const handleSend = async () => {
    if (disabled || sending) return;
    const html = editorRef.current?.getHtml() ?? '';
    if (isImRichHtmlEmpty(html)) return;
    setSending(true);
    try {
      await onSendRichHtml?.(html, editorRef.current?.getBlobFileMap() ?? new Map());
      editorRef.current?.clear();
      setCanSend(false);
    } finally {
      setSending(false);
    }
  };

  const insertPicked = async () => {
    if (!onPickImageFiles) return;
    const items = await onPickImageFiles();
    for (const item of items) {
      if (typeof item === 'string') {
        // file path — show as file:// for compose; upload replaces on send
        const src = item.startsWith('file://') ? item : `file://${item}`;
        editorRef.current?.insertImageUrl(src);
      } else {
        editorRef.current?.insertImageFile(item);
      }
    }
    refreshCanSend();
    editorRef.current?.focus();
  };

  return (
    <div className={cn('relative z-10 shrink-0 pb-3 pt-2', messagesConversationInsetClass)}>
      <InputComposerShell
        layout="home"
        className="w-full"
        editorOrOverlay={(
          <div className="flex w-full flex-col">
            {formatOpen ? (
              <ImRichFormatToolbar
                disabled={disabled || sending}
                onInsertImage={() => void insertPicked()}
              />
            ) : null}
            <div className="px-0 pt-1">
              <ImRichEditor
                ref={editorRef}
                disabled={disabled || sending}
                placeholder={t('im.inputPlaceholder')}
                onChange={refreshCanSend}
                onSubmit={() => void handleSend()}
              />
            </div>
          </div>
        )}
        toolbarLeft={(
          <ComposeToolbarLeft
            disabled={disabled || sending}
            showAgentAction={showAgentAction}
            formatActive={formatOpen}
            onToggleFormat={() => setFormatOpen((open) => !open)}
            onSendArtifact={onSendArtifact}
            onAttach={() => void insertPicked()}
          />
        )}
        toolbarRight={(
          <InputComposerSendButton
            layout="home"
            canSend={canSend && !disabled && !sending}
            onSend={() => void handleSend()}
            sendTitle={t('im.send', { defaultValue: '发送' })}
            stopTitle={t('im.send', { defaultValue: '发送' })}
          />
        )}
      />
    </div>
  );
}
