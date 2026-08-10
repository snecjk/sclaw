/**
 * Desktop Sprite (桌面小精灵) - Main Page Component
 * A compact floating assistant UI with glassmorphism styling.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Sparkles, Copy, Check, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { chatRemarkPlugins } from '@/lib/remark-gfm-chat';
import logoSvg from '@/assets/logo.svg';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { useChatStore } from '@/stores/chat';
import { getCurrentChatDisplayMessages, useCurrentChatDisplayMessages } from '@/stores/chat/display-selectors';
import { useCurrentChatRuntimeView } from '@/stores/chat/runtime-selectors';
import { invokeIpc } from '@/lib/api-client';
import { extractText } from '@/pages/Chat/message-utils';
import { QuickActions } from './QuickActions';
import { SpriteInput } from './SpriteInput';
import i18n from '@/i18n';

type SpriteView = 'welcome' | 'chat';

export function Sprite() {
  const { t } = useTranslation('sprite');
  const [view, setView] = useState<SpriteView>('welcome');
  const [lastUserText, setLastUserText] = useState('');
  const [awaitingReply, setAwaitingReply] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const msgBaseIndexRef = useRef(0);

  // Store initialization
  const initSettings = useSettingsStore((s) => s.init);
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const initGateway = useGatewayStore((s) => s.init);

  // Chat state
  const { sending, streamingMessage } = useCurrentChatRuntimeView();
  const messages = useCurrentChatDisplayMessages();
  const sendMessage = useChatStore((s) => s.sendMessage);

  // Initialize stores on mount
  useEffect(() => {
    initSettings();
    initGateway();
    // Make html/body transparent so the rounded corners don't show black
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
  }, [initSettings, initGateway]);

  // Sync language
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Apply theme (same as App.tsx)
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  // Scroll to bottom when streaming
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingMessage, messages]);

  // Sync session context from main window before sending
  const syncAndSend = useCallback(
    async (text: string) => {
      try {
        const ctx = await invokeIpc<{
          sessionKey: string;
          agentId: string;
        }>('sprite:getSessionContext');
        // Apply the session context from the main window
        if (ctx.sessionKey) {
          useChatStore.setState({
            currentSessionKey: ctx.sessionKey,
            currentAgentId: ctx.agentId || 'main',
          });
        }
      } catch {
        // If context fetch fails, use default session
      }

      setLastUserText(text);
      setView('chat');
      setAwaitingReply(true);
      msgBaseIndexRef.current = getCurrentChatDisplayMessages().length;
      sendMessage({ text });
    },
    [sendMessage],
  );

  const handleClose = useCallback(() => {
    invokeIpc('window:close');
  }, []);

  const handleShowMainWindow = useCallback(() => {
    invokeIpc('sprite:showMainWindow');
  }, []);

  const handleReset = useCallback(() => {
    setView('welcome');
    setLastUserText('');
    setAwaitingReply(false);
  }, []);

  // Extract response text using extractText which handles both string content
  // and array content blocks (e.g. [{type:"text",text:"..."}]) from the gateway.
  const streamingText = streamingMessage ? extractText(streamingMessage) : '';

  // After streaming completes, fall back to the last assistant message in history
  // so the response remains visible after the final event clears streamingMessage.
  // Only look at messages added after the current question was sent (msgBaseIndexRef)
  // to avoid showing stale responses from previous turns.
  const lastAssistantText = !streamingText
    ? (() => {
        for (let i = messages.length - 1; i >= msgBaseIndexRef.current; i--) {
          const m = messages[i];
          if (m.role === 'assistant') return extractText(m);
        }
        return '';
      })()
    : '';

  const responseText = streamingText || lastAssistantText;

  // Clear awaitingReply once we have visible response text
  useEffect(() => {
    if (responseText && awaitingReply) {
      setAwaitingReply(false);
    }
  }, [responseText, awaitingReply]);

  // Show thinking indicator while awaiting reply and no text is visible yet.
  // Uses awaitingReply instead of `sending` because intermediate gateway events
  // (e.g. tool-call final) can briefly set sending=false before the text response
  // starts streaming, which would cause the indicator to flicker/disappear.
  const isThinking = awaitingReply && !responseText;

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!responseText) return;
    navigator.clipboard.writeText(responseText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [responseText]);

  return (
    <div className="flex flex-col h-screen w-screen rounded-2xl border border-glass-border glass-panel overflow-hidden">
      {/* Drag handle header */}
      <div className="drag-region flex items-center justify-between px-4 h-10 shrink-0 select-none">
        <img src={logoSvg} className="h-6 w-6 no-drag" alt="StoClaw" draggable={false} />
        <div className="flex items-center gap-1 no-drag">
          <button
            onClick={handleShowMainWindow}
            className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-white/20 dark:hover:bg-white/10 transition-colors text-foreground/60"
            title={t('openMainWindow')}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleClose}
            className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-white/20 dark:hover:bg-white/10 transition-colors text-foreground/60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Greeting */}
      <div className="px-5 pt-1 pb-4">
        <h2 className="text-lg font-medium text-foreground/80">{t('greeting')}</h2>
      </div>

      {view === 'welcome' ? (
        /* Quick actions */
        <div className="flex-1 overflow-hidden">
          <QuickActions onAction={syncAndSend} />
        </div>
      ) : (
        /* Chat response area */
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-1 space-y-3">
          {/* User message */}
          {lastUserText && (
            <div className="flex justify-end">
              <div className="bg-primary text-primary-foreground rounded-2xl px-4 py-2 max-w-[85%] text-sm break-words">
                {lastUserText}
              </div>
            </div>
          )}

          {/* Thinking indicator */}
          {isThinking && (
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/30 dark:bg-white/[0.08] border border-glass-border text-foreground">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="bg-white/30 dark:bg-white/[0.08] border border-glass-border rounded-2xl px-4 py-2.5">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          {/* Assistant response */}
          {responseText && (
            <div className="group flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/30 dark:bg-white/[0.08] border border-glass-border text-foreground">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 max-w-[85%]">
                <div className="bg-white/30 dark:bg-white/[0.08] border border-glass-border rounded-2xl px-4 py-2.5 text-sm prose prose-sm dark:prose-invert text-foreground break-words select-text">
                  <ReactMarkdown remarkPlugins={chatRemarkPlugins}>{responseText}</ReactMarkdown>
                </div>
                <div className="flex items-center mt-1 h-5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    <span>{copied ? t('copied', { defaultValue: 'Copied' }) : t('copy', { defaultValue: 'Copy' })}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* New conversation button (when response is done) */}
          {!awaitingReply && responseText && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleReset}
                className="px-4 py-1.5 rounded-full border border-glass-border text-xs font-medium text-foreground/60 hover:bg-white/20 dark:hover:bg-white/10 transition-colors glass-subtle"
              >
                {t('greeting')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Input area */}
      <SpriteInput onSend={syncAndSend} disabled={sending} />
    </div>
  );
}

export default Sprite;
