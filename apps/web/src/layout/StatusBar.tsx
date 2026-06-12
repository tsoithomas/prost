import { StatusDot } from '@prost/ui';

export function StatusBar() {
  return (
    <footer className="hidden h-6 shrink-0 items-center justify-between border-t border-border bg-surface-sunken px-md font-mono text-xs text-text-muted md:flex">
      <div className="flex items-center gap-md">
        <span className="font-medium text-accent">Prost v0.1.0</span>
        <span>Ln 1, Col 1</span>
      </div>
      <div className="flex items-center gap-md">
        <span>UTF-8</span>
        <span>PostgreSQL 15.3</span>
        <span className="flex items-center gap-xs">
          <StatusDot variant="success" />
          Connected
        </span>
      </div>
    </footer>
  );
}
