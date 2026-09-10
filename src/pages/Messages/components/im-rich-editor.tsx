import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { cn } from '@/lib/utils';
import { sanitizeImRichHtml } from '@/lib/openim/im-rich-html';

export interface ImRichEditorHandle {
  focus: () => void;
  getHtml: () => string;
  clear: () => void;
  insertImageFile: (file: File) => void;
  insertImageUrl: (url: string, alt?: string) => void;
  isEmpty: () => boolean;
  /** blob: URL → File, for upload before send */
  getBlobFileMap: () => Map<string, File>;
}

export const ImRichEditor = forwardRef<ImRichEditorHandle, {
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onChange?: () => void;
  onSubmit?: () => void;
}>(function ImRichEditor({
  disabled,
  placeholder,
  className,
  onChange,
  onSubmit,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const blobFilesRef = useRef(new Map<string, File>());

  const insertImageAtCursor = (src: string, alt = '') => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '200px';
    img.style.borderRadius = '8px';

    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && el.contains(selection.anchorNode)) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      el.appendChild(img);
    }
  };

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    getHtml: () => sanitizeImRichHtml(editorRef.current?.innerHTML ?? '', { allowLocalImg: true }),
    clear: () => {
      if (!editorRef.current) return;
      editorRef.current.innerHTML = '';
      for (const url of blobFilesRef.current.keys()) {
        URL.revokeObjectURL(url);
      }
      blobFilesRef.current.clear();
      onChange?.();
    },
    insertImageFile: (file: File) => {
      const url = URL.createObjectURL(file);
      blobFilesRef.current.set(url, file);
      insertImageAtCursor(url, file.name);
      onChange?.();
    },
    insertImageUrl: (url: string, alt?: string) => {
      insertImageAtCursor(url, alt);
      onChange?.();
    },
    isEmpty: () => {
      const el = editorRef.current;
      if (!el) return true;
      const text = (el.textContent ?? '').replace(/\u00a0/g, ' ').trim();
      if (text) return false;
      return el.querySelectorAll('img').length === 0;
    },
    getBlobFileMap: () => new Map(blobFilesRef.current),
  }));

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const handleInput = () => onChange?.();
    el.addEventListener('input', handleInput);
    return () => el.removeEventListener('input', handleInput);
  }, [onChange]);

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;

    event.preventDefault();
    for (const file of imageFiles) {
      const url = URL.createObjectURL(file);
      blobFilesRef.current.set(url, file);
      insertImageAtCursor(url, file.name);
    }
    onChange?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="relative min-h-[72px] w-full">
      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className={cn(
          'im-rich-editor min-h-[72px] w-full resize-none border-0 bg-transparent p-0',
          'text-sm leading-6 text-foreground outline-none',
          'empty:before:pointer-events-none empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]',
          '[&_img]:my-1 [&_img]:max-h-[200px] [&_img]:max-w-full [&_img]:rounded-lg',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
});
