import type { ReactNode } from 'react';
import directoryIcon from '@/assets/icons/directory.svg';
import docIcon from '@/assets/icons/doc-icon.svg';
import excelIcon from '@/assets/icons/excel-icon.svg';
import htmlIcon from '@/assets/icons/html-icon.svg';
import imgIcon from '@/assets/icons/img-icon.svg';
import mdIcon from '@/assets/icons/md-icon.svg';
import pptIcon from '@/assets/icons/ppt-icon.svg';
import { cn } from '@/lib/utils';
import type { DataCenterSection } from '@/stores/data-center';
import type { DataCenterEntry } from '@/types/data-center';
import type { LocalAuthorizedFileEntry } from '@/types/local-authorized-file';
import { SECTION_PARAM_VALUES } from './constants';
import type { DataCenterUiEntry } from './types';

export function normalizeSectionParam(value: string | null): DataCenterSection {
  return SECTION_PARAM_VALUES.includes(value as DataCenterSection)
    ? value as DataCenterSection
    : 'qa_artifact';
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function formatUsagePercent(percent: number): string {
  if (!Number.isFinite(percent)) return '0';
  return percent.toFixed(2).replace(/\.?0+$/, '');
}

export function formatUsageProgressWidth(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) return '0%';
  return `${Math.min(100, Math.max(4, percent))}%`;
}

export function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year} / ${month} / ${day} ${hour}:${minute}`;
}

export function getEntryIconSrc(entry: DataCenterEntry): string {
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

export function localEntryToUiEntry(entry: LocalAuthorizedFileEntry): DataCenterUiEntry {
  return {
    entryId: entry.entryId,
    spaceType: 'drive',
    entryType: entry.entryType,
    parentEntryId: entry.parentEntryId,
    name: entry.name,
    mimeType: entry.mimeType,
    fileExt: entry.fileExt,
    fileSize: entry.fileSize,
    sourceType: 'local_upload',
    status: entry.missing ? 'missing' : entry.permissionDenied ? 'permission_denied' : 'active',
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    localAuthorized: true,
    localPath: entry.path,
    missing: entry.missing,
    permissionDenied: entry.permissionDenied,
  };
}

export function getEntryIcon(entry: DataCenterEntry, className = 'h-5 w-5'): ReactNode {
  return <img src={getEntryIconSrc(entry)} alt="" aria-hidden="true" className={cn('object-contain', className)} />;
}

export function getRenameInputValue(entry: DataCenterEntry): string {
  if (entry.entryType !== 'file') return entry.name;
  const ext = entry.fileExt?.trim().replace(/^\./, '') || '';
  if (ext && entry.name.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
    return entry.name.slice(0, -(ext.length + 1));
  }
  const dotIndex = entry.name.lastIndexOf('.');
  return dotIndex > 0 ? entry.name.slice(0, dotIndex) : entry.name;
}

export function buildRenamedEntryName(entry: DataCenterEntry, inputName: string): string {
  if (entry.entryType !== 'file') return inputName;
  const ext = entry.fileExt?.trim().replace(/^\./, '');
  if (!ext) return inputName;
  return `${inputName}.${ext}`;
}

export function getParentBreadcrumbId(breadcrumbs: Array<{ entryId: string; name: string }>): string {
  return breadcrumbs.length > 1 ? breadcrumbs[breadcrumbs.length - 2].entryId : 'root';
}
