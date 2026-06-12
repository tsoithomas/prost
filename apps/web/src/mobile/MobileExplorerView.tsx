import { useState } from 'react';
import { Box } from 'lucide-react';
import { StatusDot } from '@prost/ui';
import { SchemaTree } from '../explorer/SchemaTree';
import { mockSchemas } from '../mocks/schema';

export function MobileExplorerView() {
  const [selectedTable, setSelectedTable] = useState('users');

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-xs border-b border-border bg-surface-sunken px-md py-1.5">
        <Box size={14} className="text-accent" />
        <span className="font-mono text-xs text-text-muted">public</span>
        <span className="ml-auto flex items-center gap-xs text-xs text-text-faint">
          <StatusDot variant="success" />
          Connected
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-sm py-2">
        <SchemaTree schemas={mockSchemas} selectedTable={selectedTable} onSelectTable={setSelectedTable} />
      </div>
    </div>
  );
}
