import type { ReactNode } from 'react';
import directoryIcon from '@/assets/icons/directory.svg';
import docIcon from '@/assets/icons/doc-icon.svg';
import excelIcon from '@/assets/icons/excel-icon.svg';
import htmlIcon from '@/assets/icons/html-icon.svg';
import imgIcon from '@/assets/icons/img-icon.svg';
import mdIcon from '@/assets/icons/md-icon.svg';
import pptIcon from '@/assets/icons/ppt-icon.svg';
import { cn } from '@/lib/utils';
import type { DataCenterEntry } from '@/types/data-center';

/** 数据中心 / 选文件弹窗共用的 entry 类型图标解析。 */
export function getEntryIconSrc(entry: Pick<DataCenterEntry, 'entryType' | 'name' | 'fileExt'>): string {
  if (entry.entryType === 'folder') return directoryIcon;
  const ext = entry.fileExt?.toLowerCase() || entry.name.split('.').pop()?.toLowerCase() || '';
  if (['doc', 'docx', 'pdf', 'txt', 'rtf'].includes(ext)) return docIcon;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return excelIcon;
  if (['html', 'htm'].includes(ext)) return htmlIcon;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return imgIcon;
  if (['md', 'markdown'].includes(ext)) return mdIcon;
  if (['ppt', 'pptx'].includes(ext)) return pptIcon;
  return docIcon;
}

export function getEntryIcon(
  entry: Pick<DataCenterEntry, 'entryType' | 'name' | 'fileExt'>,
  className = 'h-5 w-5',
): ReactNode {
  return (
    <img
      src={getEntryIconSrc(entry)}
      alt=""
      aria-hidden="true"
      className={cn('object-contain', className)}
      draggable={false}
    />
  );
}
