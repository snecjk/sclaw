import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';

interface SpriteInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export function SpriteInput({ onSend, disabled = false }: SpriteInputProps) {
  const { t } = useTranslation('sprite');
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || disabled) return;
    onSend(text);
    setInput('');
  }, [input, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const canSend = input.trim().length > 0 && !disabled;

  return (
    <div className="shrink-0 p-3 pt-0">
      <div className="flex items-center gap-2 glass rounded-[20px] border border-glass-border p-1 pl-4">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('inputPlaceholder')}
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-w-0"
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
