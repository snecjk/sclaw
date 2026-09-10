import {
  Bold,
  Eraser,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ComposeActionIconButton } from './compose-action-icon-button';

const ICON = 'h-4 w-4';

const COLORS = [
  '#1F2329',
  '#F53F3F',
  '#FF7D00',
  '#FADC19',
  '#00B42A',
  '#3491FA',
  '#722ED1',
];

function runCommand(command: string, value?: string) {
  document.execCommand(command, false, value);
}

export function ImRichFormatToolbar({
  disabled,
  onInsertImage,
}: {
  disabled?: boolean;
  onInsertImage?: () => void;
}) {
  const insertLink = () => {
    const url = window.prompt('链接地址', 'https://');
    if (!url) return;
    runCommand('createLink', url);
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-0.5 border-b border-[#E5E6EB] px-2 py-1.5',
        'dark:border-[var(--sto-border-default)]',
      )}
      onMouseDown={(event) => {
        // Keep editor selection when clicking toolbar.
        if ((event.target as HTMLElement).closest('button')) {
          event.preventDefault();
        }
      }}
    >
      <ComposeActionIconButton label="加粗" disabled={disabled} onClick={() => runCommand('bold')}>
        <Bold className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label="斜体" disabled={disabled} onClick={() => runCommand('italic')}>
        <Italic className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label="下划线" disabled={disabled} onClick={() => runCommand('underline')}>
        <Underline className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label="删除线" disabled={disabled} onClick={() => runCommand('strikeThrough')}>
        <Strikethrough className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>

      <span className="mx-1 h-4 w-px bg-[#E5E6EB] dark:bg-[var(--sto-border-default)]" />

      <div className="flex items-center gap-1 px-1">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            disabled={disabled}
            title={color}
            className="h-4 w-4 rounded-full border border-black/10 disabled:opacity-40"
            style={{ backgroundColor: color }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => runCommand('foreColor', color)}
          />
        ))}
      </div>

      <span className="mx-1 h-4 w-px bg-[#E5E6EB] dark:bg-[var(--sto-border-default)]" />

      <ComposeActionIconButton label="无序列表" disabled={disabled} onClick={() => runCommand('insertUnorderedList')}>
        <List className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label="有序列表" disabled={disabled} onClick={() => runCommand('insertOrderedList')}>
        <ListOrdered className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label="链接" disabled={disabled} onClick={insertLink}>
        <Link2 className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label="清除格式" disabled={disabled} onClick={() => runCommand('removeFormat')}>
        <Eraser className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>
      <ComposeActionIconButton label="插入图片" disabled={disabled} onClick={onInsertImage}>
        <ImagePlus className={ICON} strokeWidth={2} />
      </ComposeActionIconButton>
    </div>
  );
}
