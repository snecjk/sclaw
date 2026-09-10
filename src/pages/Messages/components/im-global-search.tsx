import { Bot, MessageSquare, Search, Users } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { stoSearchFieldShellClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import type { IMContact, IMConversation } from '../types';

export type ImSearchResultKind = 'conversation' | 'colleague' | 'group' | 'digital_employee';

export interface ImSearchResult {
  id: string;
  kind: ImSearchResultKind;
  name: string;
  subtitle?: string;
  avatarLabel: string;
  targetConversationId?: string;
  contact?: IMContact;
}

function matchesKeyword(value: string | undefined, keyword: string): boolean {
  return (value ?? '').toLowerCase().includes(keyword);
}

export function buildImSearchIndex(
  conversations: IMConversation[],
  colleagues: IMContact[],
  groups: IMContact[],
  digitalEmployees: IMContact[],
): ImSearchResult[] {
  const conversationResults: ImSearchResult[] = conversations.map((item) => ({
    id: `conversation:${item.id}`,
    kind: 'conversation',
    name: item.name,
    subtitle: item.lastMessage,
    avatarLabel: item.avatarLabel,
    targetConversationId: item.id,
  }));

  const colleagueResults: ImSearchResult[] = colleagues.map((item) => ({
    id: `colleague:${item.id}`,
    kind: 'colleague',
    name: item.name,
    subtitle: item.subtitle,
    avatarLabel: item.avatarLabel,
    targetConversationId: conversations.find((conv) => conv.name === item.name)?.id,
    contact: item,
  }));

  const groupResults: ImSearchResult[] = groups.map((item) => ({
    id: `group:${item.id}`,
    kind: 'group',
    name: item.name,
    subtitle: item.subtitle,
    avatarLabel: item.avatarLabel,
    targetConversationId: conversations.find((conv) => conv.id === `conv-${item.id}`)?.id,
    contact: item,
  }));

  const digitalEmployeeResults: ImSearchResult[] = digitalEmployees.map((item) => ({
    id: `digital_employee:${item.id}`,
    kind: 'digital_employee',
    name: item.name,
    subtitle: item.subtitle ?? item.skills?.join(' · '),
    avatarLabel: item.avatarLabel,
    targetConversationId: conversations.find((conv) => conv.id === `conv-${item.id}`)?.id,
    contact: item,
  }));

  return [
    ...conversationResults,
    ...colleagueResults,
    ...groupResults,
    ...digitalEmployeeResults,
  ];
}

export function filterImSearchResults(items: ImSearchResult[], query: string): ImSearchResult[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return [];

  return items.filter((item) =>
    matchesKeyword(item.name, keyword)
    || matchesKeyword(item.subtitle, keyword)
    || matchesKeyword(item.avatarLabel, keyword),
  );
}

const SECTION_ORDER: ImSearchResultKind[] = [
  'conversation',
  'colleague',
  'group',
  'digital_employee',
];

function sectionTitleKey(kind: ImSearchResultKind): string {
  switch (kind) {
    case 'conversation':
      return 'im.searchSectionConversations';
    case 'colleague':
      return 'im.colleagues';
    case 'group':
      return 'im.groups';
    case 'digital_employee':
      return 'im.digitalEmployees';
    default:
      return 'im.search';
  }
}

function ResultAvatar({ result }: { result: ImSearchResult }) {
  const isDigital = result.kind === 'digital_employee';
  const isGroup = result.kind === 'group';

  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px]',
        isDigital && 'bg-[var(--sto-badge-external-background)] text-[var(--sto-badge-external-foreground)]',
        isGroup && 'bg-[var(--sto-badge-official-background)] text-[var(--sto-badge-official-foreground)]',
        result.kind === 'conversation' && 'bg-[var(--sto-surface-muted)] text-[var(--sto-text-secondary)]',
        result.kind === 'colleague' && 'bg-[var(--sto-surface-muted)] text-[var(--sto-text-secondary)]',
      )}
    >
      {isDigital ? (
        <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : isGroup ? (
        <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : result.kind === 'conversation' ? (
        <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : (
        result.avatarLabel
      )}
    </div>
  );
}

export function ImGlobalSearch({
  conversations,
  colleagues,
  groups,
  digitalEmployees,
  onSelectConversation,
  onSelectContact,
  remoteSearch,
}: {
  conversations: IMConversation[];
  colleagues: IMContact[];
  groups: IMContact[];
  digitalEmployees: IMContact[];
  onSelectConversation: (conversationId: string) => void;
  onSelectContact: (contact: IMContact) => void | Promise<void>;
  remoteSearch?: (query: string) => Promise<ImSearchResult[]>;
}) {
  const { t } = useTranslation('common');
  const rootRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [remoteResults, setRemoteResults] = useState<ImSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownBox, setDropdownBox] = useState<{ top: number; left: number; width: number } | null>(null);

  const searchIndex = useMemo(
    () => buildImSearchIndex(conversations, colleagues, groups, digitalEmployees),
    [conversations, colleagues, groups, digitalEmployees],
  );

  useEffect(() => {
    if (!remoteSearch) {
      setRemoteResults([]);
      return;
    }

    const keyword = query.trim();
    if (!keyword) {
      setRemoteResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const timer = window.setTimeout(() => {
      void remoteSearch(keyword)
        .then((items) => setRemoteResults(items))
        .catch(() => setRemoteResults([]))
        .finally(() => setSearching(false));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, remoteSearch]);

  const localResults = useMemo(
    () => filterImSearchResults(searchIndex, query),
    [searchIndex, query],
  );

  const results = useMemo(() => {
    if (!remoteSearch) return localResults;
    const conversationResults = localResults.filter((item) => item.kind === 'conversation');
    const digitalResults = localResults.filter((item) => item.kind === 'digital_employee');
    const merged = [...conversationResults, ...remoteResults, ...digitalResults];
    const seen = new Set<string>();
    return merged.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [localResults, remoteResults, remoteSearch]);

  const groupedResults = useMemo(() => {
    const groupsByKind = new Map<ImSearchResultKind, ImSearchResult[]>();
    for (const kind of SECTION_ORDER) {
      groupsByKind.set(kind, []);
    }
    for (const result of results) {
      groupsByKind.get(result.kind)?.push(result);
    }
    return SECTION_ORDER
      .map((kind) => ({ kind, items: groupsByKind.get(kind) ?? [] }))
      .filter((section) => section.items.length > 0);
  }, [results]);

  const showDropdown = open && query.trim().length > 0;

  useLayoutEffect(() => {
    if (!showDropdown) {
      setDropdownBox(null);
      return;
    }

    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownBox({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [showDropdown, query, groupedResults.length]);

  useEffect(() => {
    if (!showDropdown) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showDropdown]);

  const handleSelect = async (result: ImSearchResult) => {
    try {
      if (result.targetConversationId) {
        onSelectConversation(result.targetConversationId);
      } else if (result.contact) {
        await onSelectContact(result.contact);
      }
    } finally {
      setQuery('');
      setOpen(false);
    }
  };

  const dropdown = showDropdown && dropdownBox
    ? createPortal(
      <div
        ref={dropdownRef}
        className={cn(
          'no-drag sto-overlay sto-overlay--content-border fixed z-[10050]',
          'max-h-[min(420px,50vh)] overflow-y-auto rounded-xl border p-2 shadow-[var(--sto-shadow-content-popover)]',
        )}
        style={{
          top: dropdownBox.top,
          left: dropdownBox.left,
          width: dropdownBox.width,
        }}
        onMouseDown={(event) => {
          // Keep focus/selection inside the portaled panel; avoid header drag-region.
          event.stopPropagation();
        }}
      >
        {groupedResults.length > 0 ? (
          groupedResults.map((section) => (
            <div key={section.kind} className="py-1">
              <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                {t(sectionTitleKey(section.kind))}
              </div>
              <div className="flex flex-col gap-0.5">
                {section.items.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onMouseDown={(event) => {
                      // Prevent input blur / drag-region from eating the click.
                      event.preventDefault();
                    }}
                    onClick={() => {
                      void handleSelect(result);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--sto-content-hover-background)]"
                  >
                    <ResultAvatar result={result} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-foreground">{result.name}</div>
                      {result.subtitle ? (
                        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{result.subtitle}</div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        ) : (
          <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            {searching ? t('im.loadingHistory') : t('im.searchNoResults')}
          </div>
        )}
      </div>,
      document.body,
    )
    : null;

  return (
    <div ref={rootRef} className="no-drag relative w-full max-w-[520px]">
      <div
        className={cn(
          stoSearchFieldShellClass,
          'h-8 bg-[var(--sto-panel-bg)] shadow-[var(--sto-workspace-shadow)]',
          showDropdown && 'border-primary/70 ring-2 ring-primary/15',
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('im.globalSearchPlaceholder')}
          className="h-7 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
        />
      </div>
      {dropdown}
    </div>
  );
}
