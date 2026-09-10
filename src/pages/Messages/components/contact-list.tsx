import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ImAvatar } from './im-avatar';
import type { IMContact } from '../types';

function contactKindToAvatarKind(kind: IMContact['kind']): 'single' | 'group' | 'digital_employee' {
  if (kind === 'digital_employee') return 'digital_employee';
  if (kind === 'group') return 'group';
  return 'single';
}

function StatusDot({ status }: { status?: IMContact['status'] }) {
  if (!status) return null;
  const color =
    status === 'online'
      ? 'bg-emerald-500'
      : status === 'busy'
        ? 'bg-amber-500'
        : 'bg-[var(--sto-text-tertiary)]';
  return <span className={cn('h-2 w-2 rounded-full', color)} />;
}

function ContactSection({
  title,
  contacts,
  onSelect,
  defaultExpanded = true,
}: {
  title: string;
  contacts: IMContact[];
  onSelect: (contact: IMContact) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (contacts.length === 0) return null;

  return (
    <div className="px-2 py-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--sto-surface-hover)]"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--sto-text-tertiary)]" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--sto-text-tertiary)]" strokeWidth={2} />
        )}
        <span className="text-[12px] font-medium text-[var(--sto-text-tertiary)]">{title}</span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-0.5">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onClick={() => onSelect(contact)}
              className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[var(--sto-surface-hover)]"
            >
              <ImAvatar kind={contactKindToAvatarKind(contact.kind)} label={contact.avatarLabel} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-[var(--sto-text-primary)]">{contact.name}</span>
                  <StatusDot status={contact.status} />
                </div>
                {contact.subtitle ? (
                  <div className="mt-0.5 truncate text-[13px] text-[var(--sto-text-tertiary)]">{contact.subtitle}</div>
                ) : null}
                {contact.skills && contact.skills.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {contact.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded bg-[var(--sto-surface-muted)] px-1.5 py-0.5 text-[11px] text-[var(--sto-text-secondary)]"
                      >
                        #{skill}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ContactList({
  digitalEmployees,
  colleagues,
  groups,
  onSelect,
}: {
  digitalEmployees: IMContact[];
  colleagues: IMContact[];
  groups: IMContact[];
  onSelect: (contact: IMContact) => void;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
      <ContactSection title={t('im.digitalEmployees')} contacts={digitalEmployees} onSelect={onSelect} />
      <ContactSection title={t('im.colleagues')} contacts={colleagues} onSelect={onSelect} />
      <ContactSection title={t('im.groups')} contacts={groups} onSelect={onSelect} />
    </div>
  );
}
