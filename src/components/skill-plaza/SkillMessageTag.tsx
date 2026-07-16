import { Wrench } from 'lucide-react';
import { skillMessageTagClass } from '@/lib/surfaces';
import { cn } from '@/lib/utils';

interface SkillMessageTagProps {
  title: string;
  className?: string;
}

export function SkillMessageTag({ title, className }: SkillMessageTagProps) {
  return (
    <span className={cn(skillMessageTagClass, className)}>
      <Wrench className="h-3 w-3 shrink-0" aria-hidden />
      <span>{title}</span>
    </span>
  );
}
