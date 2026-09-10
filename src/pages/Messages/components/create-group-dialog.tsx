import { ChevronRight, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { IconCheckbox } from '@/components/icon-checkbox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { stoSearchFieldShellClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';
import type { IMOrgDepartment, IMOrgMember } from '../types';

function buildDepartmentTree(departments: IMOrgDepartment[]) {
  const roots = departments.filter((item) => !item.parentId);
  const childrenByParent = new Map<string, IMOrgDepartment[]>();

  for (const department of departments) {
    if (!department.parentId) continue;
    const siblings = childrenByParent.get(department.parentId) ?? [];
    siblings.push(department);
    childrenByParent.set(department.parentId, siblings);
  }

  return { roots, childrenByParent };
}

function DepartmentTreeNode({
  department,
  childrenByParent,
  activeDepartmentId,
  depth,
  onSelect,
}: {
  department: IMOrgDepartment;
  childrenByParent: Map<string, IMOrgDepartment[]>;
  activeDepartmentId: string;
  depth: number;
  onSelect: (departmentId: string) => void;
}) {
  const children = childrenByParent.get(department.id) ?? [];
  const active = department.id === activeDepartmentId;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(department.id)}
        className={cn(
          'flex w-full items-center gap-1 rounded-lg px-2 py-2 text-left text-[13px] transition-colors',
          active
            ? 'bg-[var(--sto-content-hover-background)] font-medium text-foreground'
            : 'text-foreground hover:bg-[var(--sto-content-hover-background)]',
        )}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {children.length > 0 ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">{department.name}</span>
      </button>
      {children.map((child) => (
        <DepartmentTreeNode
          key={child.id}
          department={child}
          childrenByParent={childrenByParent}
          activeDepartmentId={activeDepartmentId}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function MemberRow({
  member,
  checked,
  onToggle,
}: {
  member: IMOrgMember;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--sto-content-hover-background)]"
    >
      <IconCheckbox checked={checked} onCheckedChange={() => onToggle()} />
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--sto-surface-muted)] text-[12px] text-[var(--sto-text-secondary)]">
        {member.avatarLabel}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-foreground">{member.name}</div>
        <div className="truncate text-[12px] text-muted-foreground">{member.title}</div>
      </div>
    </button>
  );
}

export function CreateGroupDialog({
  open,
  departments,
  members,
  memberPickerMode = 'org',
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  departments: IMOrgDepartment[];
  members: IMOrgMember[];
  memberPickerMode?: 'org' | 'friends';
  onOpenChange: (open: boolean) => void;
  onConfirm: (selectedMembers: IMOrgMember[], groupName?: string) => void;
}) {
  const { t } = useTranslation('common');
  const { roots, childrenByParent } = useMemo(() => buildDepartmentTree(departments), [departments]);
  const [activeDepartmentId, setActiveDepartmentId] = useState(roots[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectedMembers = useMemo(
    () => members.filter((member) => selectedIds.includes(member.id)),
    [members, selectedIds],
  );

  const visibleMembers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const scoped = memberPickerMode === 'friends' || keyword
      ? members
      : members.filter((member) => member.departmentId === activeDepartmentId);

    if (!keyword) return scoped;
    return scoped.filter(
      (member) =>
        member.name.toLowerCase().includes(keyword)
        || member.title.toLowerCase().includes(keyword),
    );
  }, [activeDepartmentId, memberPickerMode, members, query]);

  const toggleMember = (memberId: string) => {
    setSelectedIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setQuery('');
      setGroupName('');
      setSelectedIds([]);
      setActiveDepartmentId(roots[0]?.id ?? '');
    }
    onOpenChange(nextOpen);
  };

  const handleConfirm = () => {
    if (selectedMembers.length < 2) {
      toast.message(t('im.createGroupNeedMembers'));
      return;
    }
    onConfirm(selectedMembers, groupName.trim() || undefined);
    handleClose(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[min(720px,88vh)] max-w-[760px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t('im.createGroupTitle')}</DialogTitle>
        </DialogHeader>

        <div className={cn(
          'grid min-h-0 flex-1',
          memberPickerMode === 'org' ? 'grid-cols-[220px_minmax(0,1fr)]' : 'grid-cols-1',
        )}>
          {memberPickerMode === 'org' ? (
            <div className="min-h-0 border-r border-border bg-[var(--sto-surface-elevated)] p-3">
              <div className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
                {t('im.createGroupOrgContacts')}
              </div>
              <div className="min-h-0 overflow-y-auto">
                {roots.map((department) => (
                  <DepartmentTreeNode
                    key={department.id}
                    department={department}
                    childrenByParent={childrenByParent}
                    activeDepartmentId={activeDepartmentId}
                    depth={0}
                    onSelect={setActiveDepartmentId}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="border-b border-border px-4 py-3">
              <div className={stoSearchFieldShellClass}>
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('im.createGroupSearchMembers')}
                  className="h-8 border-0 bg-transparent px-0 text-[13px] shadow-none focus-visible:ring-0"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {visibleMembers.length > 0 ? (
                visibleMembers.map((member) => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    checked={selectedIds.includes(member.id)}
                    onToggle={() => toggleMember(member.id)}
                  />
                ))
              ) : (
                <div className="px-3 py-10 text-center text-[13px] text-muted-foreground">
                  {t('im.searchNoResults')}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-border px-5 py-3">
          <Input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder={t('im.createGroupNamePlaceholder')}
            className="h-9 text-[13px]"
          />
          {selectedMembers.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-muted-foreground">
                {t('im.createGroupSelected', { count: selectedMembers.length })}
              </span>
              {selectedMembers.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => toggleMember(member.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--sto-surface-muted)] px-2.5 py-1 text-[12px] text-foreground"
                >
                  {member.name}
                  <X className="h-3 w-3 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => handleClose(false)}>
            {t('actions.cancel')}
          </Button>
          <Button type="button" onClick={handleConfirm}>
            {t('im.createGroupConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
