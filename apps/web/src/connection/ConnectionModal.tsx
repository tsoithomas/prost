import { useEffect, useState } from 'react';
import { ArrowRight, Cable, Database, Eye, EyeOff, Plus, X, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { ConnectionDto } from '@prost/shared-types';
import { Badge, Button, Checkbox, IconButton, Input, Surface } from '@prost/ui';
import { FormField } from '../components/FormField';
import { mockConnections } from '../mocks/connections';

export interface ConnectionModalProps {
  open: boolean;
  onClose: () => void;
}

interface ConnectionFormState {
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
}

const blankForm: ConnectionFormState = {
  name: '',
  host: '',
  port: '5432',
  database: '',
  username: '',
  password: '',
  sslEnabled: true,
};

function toFormState(connection: ConnectionDto): ConnectionFormState {
  return {
    name: connection.name,
    host: connection.host,
    port: String(connection.port),
    database: connection.database,
    username: connection.username,
    password: '',
    sslEnabled: connection.sslEnabled,
  };
}

const firstConnection = mockConnections[0];

export function ConnectionModal({ open, onClose }: ConnectionModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(firstConnection?.id ?? null);
  const [form, setForm] = useState<ConnectionFormState>(() =>
    firstConnection ? toFormState(firstConnection) : blankForm,
  );
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function selectConnection(connection: ConnectionDto) {
    setSelectedId(connection.id);
    setForm(toFormState(connection));
    setShowPassword(false);
  }

  function startNewConnection() {
    setSelectedId(null);
    setForm(blankForm);
    setShowPassword(false);
  }

  function updateField<K extends keyof ConnectionFormState>(key: K, value: ConnectionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md" onClick={onClose}>
      <Surface
        level="overlay"
        bordered
        onClick={(event) => event.stopPropagation()}
        className="flex h-[min(560px,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg shadow-2xl md:flex-row"
      >
        <div className="flex h-1/3 shrink-0 flex-col border-b border-border md:h-full md:w-1/3 md:border-b-0 md:border-r">
          <Surface level="raised" className="flex h-12 shrink-0 items-center border-b border-border px-lg">
            <Database size={18} className="mr-sm text-accent" />
            <span className="text-sm font-semibold text-text">Connections</span>
          </Surface>
          <div className="mt-sm flex items-center justify-between px-md py-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Recent</span>
            <IconButton aria-label="New connection" onClick={startNewConnection}>
              <Plus size={16} />
            </IconButton>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto px-xs py-xs">
            {mockConnections.map((connection) => {
              const isActive = connection.id === selectedId;
              return (
                <button
                  key={connection.id}
                  type="button"
                  onClick={() => selectConnection(connection)}
                  className={clsx(
                    'flex w-full items-center gap-sm rounded-sm border border-transparent p-sm text-left transition-colors',
                    isActive ? 'bg-accent-muted text-accent' : 'text-text hover:bg-surface-hover',
                  )}
                >
                  <Cable size={16} className={isActive ? 'text-accent' : 'text-text-faint'} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{connection.name}</span>
                    <span className="truncate font-mono text-xs text-text-faint">
                      {connection.host}:{connection.port}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
            <span className="text-sm font-semibold text-text">{selectedId ? 'Edit Connection' : 'New Connection'}</span>
            <div className="flex items-center gap-sm">
              <Badge variant="accent">PostgreSQL</Badge>
              <IconButton aria-label="Close" onClick={onClose}>
                <X size={16} />
              </IconButton>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-lg">
            <form className="flex flex-col gap-lg" onSubmit={(event) => event.preventDefault()}>
              <FormField label="Connection Name">
                <Input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="My Database" />
              </FormField>

              <div className="h-px bg-border" />

              <div className="grid grid-cols-4 gap-md">
                <FormField label="Host" className="col-span-3">
                  <Input
                    className="font-mono"
                    value={form.host}
                    onChange={(event) => updateField('host', event.target.value)}
                    placeholder="localhost"
                  />
                </FormField>
                <FormField label="Port">
                  <Input
                    className="font-mono"
                    type="number"
                    value={form.port}
                    onChange={(event) => updateField('port', event.target.value)}
                  />
                </FormField>
              </div>

              <FormField label="Database">
                <Input
                  className="font-mono"
                  value={form.database}
                  onChange={(event) => updateField('database', event.target.value)}
                  placeholder="postgres"
                />
              </FormField>

              <div className="h-px bg-border" />

              <div className="grid grid-cols-2 gap-md">
                <FormField label="User">
                  <Input
                    className="font-mono"
                    value={form.username}
                    onChange={(event) => updateField('username', event.target.value)}
                    placeholder="postgres"
                  />
                </FormField>
                <FormField label="Password">
                  <div className="relative">
                    <Input
                      className="font-mono"
                      style={{ paddingRight: 32 }}
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={(event) => updateField('password', event.target.value)}
                      placeholder={selectedId ? '••••••••' : ''}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-sm top-1/2 -translate-y-1/2 text-text-faint hover:text-text"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </FormField>
              </div>

              <label className="flex w-max items-center gap-sm text-sm text-text">
                <Checkbox
                  checked={form.sslEnabled}
                  onChange={(event) => updateField('sslEnabled', event.target.checked)}
                />
                Require SSL
              </label>
            </form>
          </div>

          <Surface level="raised" className="flex h-16 shrink-0 items-center justify-between border-t border-border px-lg">
            <Button variant="secondary" size="sm">
              <Zap size={14} />
              Test Connection
            </Button>
            <div className="flex items-center gap-md">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm">
                Connect
                <ArrowRight size={14} />
              </Button>
            </div>
          </Surface>
        </div>
      </Surface>
    </div>
  );
}
