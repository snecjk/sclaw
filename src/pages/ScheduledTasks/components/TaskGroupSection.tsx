import { ChevronRight, FileText } from 'lucide-react';
import { formatMaterialDateFromEntryId } from '@/lib/sto-task-entry-label';
import { useTranslation } from 'react-i18next';

interface TaskGroupSectionProps {
  title: string;
  entries: string[];
  onEntryClick: (entryId: string) => void;
}

export function TaskGroupSection({ title, entries, onEntryClick }: TaskGroupSectionProps) {
  const { i18n } = useTranslation('tasks');
  
  // Sort entries in descending order (newest first)
  const sortedEntries = [...entries].sort((a, b) => b.localeCompare(a));

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground mb-4">{title}</h2>
      <div className="space-y-2">
        {sortedEntries.map((entryId) => {
          const dateLabel = formatMaterialDateFromEntryId(entryId, i18n.language);
          return (
            <button
              key={entryId}
              type="button"
              onClick={() => onEntryClick(entryId)}
              className="w-full flex items-center justify-between gap-3 p-4 rounded-xl border border-border bg-background hover:border-primary/30 hover:bg-muted/30 transition-colors text-left group"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <FileText className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                <span className="text-[14px] font-medium text-foreground truncate">
                  {dateLabel}材料
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
