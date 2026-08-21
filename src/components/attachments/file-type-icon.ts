import wordIcon from '@/assets/icons/file-types/word.svg';
import excelIcon from '@/assets/icons/file-types/excel.svg';
import pptIcon from '@/assets/icons/file-types/ppt.svg';
import pdfIcon from '@/assets/icons/file-types/pdf.svg';
import imgIcon from '@/assets/icons/file-types/img.svg';
import mdIcon from '@/assets/icons/file-types/md.svg';
import htmlIcon from '@/assets/icons/file-types/html.svg';
import codeIcon from '@/assets/icons/file-types/code.svg';
import otherIcon from '@/assets/icons/file-types/other.svg';

const WORD_EXT = new Set(['doc', 'docx', 'rtf', 'odt']);
const EXCEL_EXT = new Set(['xls', 'xlsx', 'csv', 'ods']);
const PPT_EXT = new Set(['ppt', 'pptx', 'odp']);
const PDF_EXT = new Set(['pdf']);
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'heic', 'tif', 'tiff']);
const MD_EXT = new Set(['md', 'markdown']);
const HTML_EXT = new Set(['html', 'htm']);
const CODE_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'h', 'hpp', 'cs',
  'php', 'sh', 'bash', 'zsh', 'ps1',
  'json', 'yaml', 'yml', 'toml', 'xml',
  'sql', 'graphql', 'vue', 'svelte',
]);

export type FileTypeIconKind =
  | 'word'
  | 'excel'
  | 'ppt'
  | 'pdf'
  | 'img'
  | 'md'
  | 'html'
  | 'code'
  | 'other';

const ICON_SRC: Record<FileTypeIconKind, string> = {
  word: wordIcon,
  excel: excelIcon,
  ppt: pptIcon,
  pdf: pdfIcon,
  img: imgIcon,
  md: mdIcon,
  html: htmlIcon,
  code: codeIcon,
  other: otherIcon,
};

function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || fileName;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function resolveFileTypeIconKind(fileName: string, mimeType?: string | null): FileTypeIconKind {
  const ext = extensionOf(fileName);
  if (WORD_EXT.has(ext)) return 'word';
  if (EXCEL_EXT.has(ext)) return 'excel';
  if (PPT_EXT.has(ext)) return 'ppt';
  if (PDF_EXT.has(ext)) return 'pdf';
  if (IMG_EXT.has(ext)) return 'img';
  if (MD_EXT.has(ext)) return 'md';
  if (HTML_EXT.has(ext)) return 'html';
  if (CODE_EXT.has(ext)) return 'code';

  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'img';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') return 'excel';
  if (mime.includes('presentation') || mime.includes('powerpoint')) return 'ppt';
  if (mime.includes('wordprocessing') || mime.includes('msword')) return 'word';
  if (mime === 'text/html') return 'html';
  if (mime === 'text/markdown' || mime === 'text/x-markdown') return 'md';
  if (
    mime.startsWith('text/')
    || mime.includes('javascript')
    || mime.includes('typescript')
    || mime.includes('json')
    || mime.includes('xml')
  ) {
    return 'code';
  }
  return 'other';
}

export function resolveFileTypeIconSrc(fileName: string, mimeType?: string | null): string {
  return ICON_SRC[resolveFileTypeIconKind(fileName, mimeType)];
}

/** 文件名中间省略，尽量保留扩展名。 */
export function middleEllipsisFileName(fileName: string, maxChars = 32): string {
  if (fileName.length <= maxChars) return fileName;
  const dot = fileName.lastIndexOf('.');
  const hasExt = dot > 0 && dot < fileName.length - 1 && fileName.length - dot <= 8;
  const ext = hasExt ? fileName.slice(dot) : '';
  const base = hasExt ? fileName.slice(0, dot) : fileName;
  const budget = maxChars - ext.length - 1;
  if (budget < 4) {
    return `${fileName.slice(0, Math.max(1, maxChars - 1))}…`;
  }
  const head = Math.ceil(budget / 2);
  const tail = Math.floor(budget / 2);
  return `${base.slice(0, head)}…${base.slice(-tail)}${ext}`;
}

/** 输入 token / 气泡共用的 chip 外观（与设计稿对齐）。 */
export const ATTACHMENT_CHIP_SURFACE_CLASS = [
  'inline-flex',
  'h-[26px]',
  'max-w-[280px]',
  'items-center',
  'gap-2',
  'overflow-hidden',
  'rounded-[6px]',
  'bg-[#F0F2F5]',
  'p-1',
  'align-middle',
  'text-[12px]',
  'font-normal',
  'leading-[12px]',
  'text-[#1D2129]',
  'dark:bg-muted',
  'dark:text-foreground',
].join(' ');
