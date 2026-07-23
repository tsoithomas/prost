import { ChevronRight } from 'lucide-react';

export interface BreadcrumbsProps {
  segments: string[];
}

export function Breadcrumbs({ segments }: BreadcrumbsProps) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-surface px-md text-xs text-text-muted max-md:hidden">
      {segments.map((segment, index) => (
        <span key={segment} className="flex items-center gap-1">
          {index > 0 ? <ChevronRight size={12} className="text-text-faint" /> : null}
          <span className={index === segments.length - 1 ? 'text-text' : undefined}>{segment}</span>
        </span>
      ))}
    </div>
  );
}
