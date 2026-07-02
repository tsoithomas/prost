import { useEffect, useState } from 'react';
import { ArrowRight, Cable, Database, Eye, EyeOff, Plus, Save, Trash2, X, Zap } from 'lucide-react';
import clsx from 'clsx';
import type { ConnectionDto, DbEngine, DbEngineDescriptor } from '@prost/shared-types';
import { parseConnectionString } from '@prost/utils';
import { Badge, Button, Checkbox, IconButton, Input, Surface } from '@prost/ui';
import {
  useConnections,
  useCreateConnection,
  useDeleteConnection,
  useTestConnection,
  useUpdateConnection,
} from '../api/connections';
import { useDatabaseEngines } from '../api/databaseEngines';
import { FormField } from '../components/FormField';
import { useConfirm } from '../hooks/useConfirm';
import { apiErrorMessage } from '../lib/apiClient';
import { useConnectionStore } from '../stores/connectionStore';
import { connectionEndpoint, connectionLocation } from './connectionDisplay';

export interface ConnectionModalProps {
  open: boolean;
  onClose: () => void;
}

interface ConnectionFormState {
  engine: DbEngine;
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  sslRejectUnauthorized: boolean;
}

const blankForm: ConnectionFormState = {
  engine: 'postgres',
  name: '',
  host: '',
  port: '5432',
  database: '',
  username: '',
  password: '',
  sslEnabled: true,
  sslRejectUnauthorized: true,
};

// Per-engine placeholder hints for the host/database/user fields, swapped when the engine
// radio changes so the examples match the selected engine's conventions.
const enginePlaceholders: Record<DbEngine, { host: string; database: string; username: string }> = {
  postgres: { host: 'localhost', database: 'postgres', username: 'postgres' },
  mysql: { host: 'localhost', database: 'mydb', username: 'root' },
  sqlite: { host: '', database: '', username: '' },
};

const fallbackNetworkEngine: DbEngineDescriptor = {
  engine: 'postgres',
  label: 'PostgreSQL',
  connectionMode: 'network',
  defaultPort: 5432,
  uriSchemes: ['postgres', 'postgresql'],
  parserDialect: 'postgresql',
  formatterDialect: 'postgresql',
  namespaceLabel: 'Schema',
  defaultNamespace: 'public',
  supportsSsl: true,
  sslEnabledByDefault: true,
  supportsCursors: true,
  ddl: {
    columnTypes: [],
    defaultExamples: [],
    indexMethods: [],
    supportsAutoIncrement: false,
    supportsUsingExpression: true,
  },
};

function toFormState(connection: ConnectionDto): ConnectionFormState {
  return {
    engine: connection.engine,
    name: connection.name,
    host: connection.host,
    port: String(connection.port),
    database: connection.database,
    username: connection.username,
    password: '',
    sslEnabled: connection.sslEnabled,
    sslRejectUnauthorized: connection.sslRejectUnauthorized,
  };
}

export function ConnectionModal({ open, onClose }: ConnectionModalProps) {
  const { data: connections = [], isLoading: connectionsLoading } = useConnections();
  const { data: databaseEngines } = useDatabaseEngines();
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const setActive = useConnectionStore((state) => state.setActive);

  const createConnection = useCreateConnection();
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();
  const testConnection = useTestConnection();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectionFormState>(blankForm);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState('');

  // Default the selection to the active connection (or the first saved one) once the
  // connection list has loaded; falls back to the "New Connection" form if there are none.
  useEffect(() => {
    if (!open || initialized || connectionsLoading) return;
    const initial = connections.find((c) => c.id === activeConnectionId) ?? connections[0] ?? null;
    if (initial) {
      setSelectedId(initial.id);
      setForm(toFormState(initial));
    } else {
      setSelectedId(null);
      setForm(blankForm);
    }
    setInitialized(true);
  }, [open, initialized, connectionsLoading, connections, activeConnectionId]);

  useEffect(() => {
    if (open) return;
    setInitialized(false);
    setShowPassword(false);
    setFormError(null);
    setImportOpen(false);
    setImportValue('');
    testConnection.reset();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const descriptors = databaseEngines ?? [fallbackNetworkEngine];
  const networkEngines = descriptors.filter((descriptor) => descriptor.connectionMode === 'network');
  const selectedConnection = connections.find((c) => c.id === selectedId) ?? null;
  const selectedReadOnly = selectedConnection?.capabilities.readOnly ?? false;
  const currentEngine = selectedConnection?.engine ?? form.engine;
  const currentEngineDescriptor = descriptors.find((descriptor) => descriptor.engine === currentEngine);
  const engineLabel =
    currentEngineDescriptor?.label ?? `${currentEngine.charAt(0).toUpperCase()}${currentEngine.slice(1)}`;
  const placeholders = enginePlaceholders[form.engine] ?? enginePlaceholders.postgres;
  const showEnginePicker = !selectedReadOnly && !selectedId && networkEngines.length >= 2;

  function selectConnection(connection: ConnectionDto) {
    setSelectedId(connection.id);
    setForm(toFormState(connection));
    setShowPassword(false);
    setFormError(null);
    testConnection.reset();
  }

  function startNewConnection() {
    setSelectedId(null);
    setForm(blankForm);
    setShowPassword(false);
    setFormError(null);
    testConnection.reset();
  }

  function updateField<K extends keyof ConnectionFormState>(key: K, value: ConnectionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    testConnection.reset();
  }

  function handleEngineChange(engine: DbEngine) {
    const descriptor = networkEngines.find((candidate) => candidate.engine === engine);
    setForm((prev) => ({
      ...prev,
      engine,
      port: String(descriptor?.defaultPort ?? prev.port),
      sslEnabled: descriptor?.sslEnabledByDefault ?? prev.sslEnabled,
    }));
    testConnection.reset();
  }

  function handleImport() {
    const result = parseConnectionString(importValue);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    const { engine, host, port, database, username, password, sslEnabled, sslRejectUnauthorized } = result.value;
    setForm((prev) => ({
      ...prev,
      engine,
      name: prev.name.trim() ? prev.name : database || prev.name,
      host,
      port: String(port),
      database,
      username,
      password,
      sslEnabled,
      sslRejectUnauthorized,
    }));
    setFormError(null);
    setImportValue('');
    setImportOpen(false);
    testConnection.reset();
  }

  function validate(requirePassword: boolean): string | null {
    if (!form.name.trim()) return 'Connection name is required.';
    if (!form.host.trim()) return 'Host is required.';
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Port must be between 1 and 65535.';
    if (!form.database.trim()) return 'Database is required.';
    if (!form.username.trim()) return 'Username is required.';
    if (requirePassword && !form.password) return 'Password is required.';
    return null;
  }

  function handleTest() {
    const error = validate(!selectedId);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const port = Number(form.port);
    testConnection.mutate({
      id: selectedId ?? undefined,
      ...(!selectedId ? { engine: form.engine } : {}),
      host: form.host,
      port,
      database: form.database,
      username: form.username,
      password: form.password || undefined,
      sslEnabled: form.sslEnabled,
      sslRejectUnauthorized: form.sslRejectUnauthorized,
    });
  }

  function handleSave() {
    if (!selectedId) return;
    const error = validate(false);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    updateConnection.mutate(
      {
        id: selectedId,
        dto: {
          name: form.name,
          host: form.host,
          port: Number(form.port),
          database: form.database,
          username: form.username,
          password: form.password || undefined,
          sslEnabled: form.sslEnabled,
          sslRejectUnauthorized: form.sslRejectUnauthorized,
        },
      },
      {
        onSuccess: () => setForm((prev) => ({ ...prev, password: '' })),
        onError: (err) => setFormError(apiErrorMessage(err, 'Failed to save connection.')),
      },
    );
  }

  async function handleDelete(connection: ConnectionDto) {
    const confirmed = await confirm({
      title: 'Delete connection',
      description: `Delete connection "${connection.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;

    deleteConnection.mutate(connection.id, {
      onSuccess: () => {
        if (activeConnectionId === connection.id) {
          setActive(null);
        }
        if (selectedId === connection.id) {
          startNewConnection();
        }
      },
      onError: (err) => setFormError(apiErrorMessage(err, 'Failed to delete connection.')),
    });
  }

  function handleConnect() {
    if (selectedId) {
      setActive(selectedId);
      onClose();
      return;
    }

    const error = validate(true);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);

    createConnection.mutate(
      {
        engine: form.engine,
        name: form.name,
        host: form.host,
        port: Number(form.port),
        database: form.database,
        username: form.username,
        password: form.password,
        sslEnabled: form.sslEnabled,
        sslRejectUnauthorized: form.sslRejectUnauthorized,
      },
      {
        onSuccess: (created) => {
          setActive(created.id);
          onClose();
        },
        onError: (err) => setFormError(apiErrorMessage(err, 'Failed to create connection.')),
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md">
      <Surface
        level="overlay"
        bordered
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
            {/* Synthetic entry for the in-progress new connection — selected when no saved
                connection is, so it's clear the form creates a new one rather than editing. */}
            <button
              type="button"
              onClick={startNewConnection}
              className={clsx(
                'flex w-full items-center gap-sm rounded-sm border border-transparent p-sm text-left transition-colors',
                selectedId === null ? 'bg-accent-muted text-accent' : 'text-text hover:bg-surface-hover',
              )}
            >
              <Plus size={16} className={clsx('shrink-0', selectedId === null ? 'text-accent' : 'text-text-faint')} />
              <span className="truncate text-sm">New Connection</span>
            </button>
            {connectionsLoading ? (
              <p className="px-sm py-2 text-xs italic text-text-faint">Loading connections…</p>
            ) : connections.length === 0 ? null : (
              connections.map((connection) => {
                const isSelected = connection.id === selectedId;
                const isActiveConnection = connection.id === activeConnectionId;
                return (
                  <div key={connection.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => selectConnection(connection)}
                      className={clsx(
                        'flex w-full items-center gap-sm rounded-sm border border-transparent p-sm pr-8 text-left transition-colors',
                        isSelected ? 'bg-accent-muted text-accent' : 'text-text hover:bg-surface-hover',
                      )}
                    >
                      <Cable size={16} className={clsx('shrink-0', isSelected ? 'text-accent' : 'text-text-faint')} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{connection.name}</span>
                        <span className="truncate font-mono text-xs text-text-faint">
                          {connectionEndpoint(connection)}
                        </span>
                      </div>
                      {connection.capabilities.readOnly ? (
                        <Badge variant="neutral" className="ml-auto shrink-0">
                          Read-only
                        </Badge>
                      ) : isActiveConnection ? (
                        <Badge variant="success" className="ml-auto shrink-0">
                          Active
                        </Badge>
                      ) : null}
                    </button>
                    {connection.capabilities.readOnly ? null : (
                      <IconButton
                        aria-label={`Delete ${connection.name}`}
                        className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDelete(connection);
                        }}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
            <span className="text-sm font-semibold text-text">
              {selectedReadOnly ? 'Connection' : selectedId ? 'Edit Connection' : 'New Connection'}
            </span>
            <div className="flex items-center gap-md">
              {showEnginePicker ? (
                <fieldset className="flex items-center gap-md" aria-label="Engine">
                  {networkEngines.map((descriptor) => (
                    <label
                      key={descriptor.engine}
                      className="flex cursor-pointer items-center gap-xs text-xs font-medium text-text"
                    >
                      <input
                        type="radio"
                        name="engine"
                        value={descriptor.engine}
                        checked={form.engine === descriptor.engine}
                        onChange={() => handleEngineChange(descriptor.engine)}
                        className="h-4 w-4 cursor-pointer accent-[var(--color-accent)]"
                      />
                      {descriptor.label}
                    </label>
                  ))}
                </fieldset>
              ) : (
                <Badge variant="accent">{engineLabel}</Badge>
              )}
              <IconButton aria-label="Close" onClick={onClose}>
                <X size={16} />
              </IconButton>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-lg">
            {selectedReadOnly && selectedConnection ? (
              <div className="flex flex-col gap-lg">
                <FormField label="Connection Name">
                  <Input value={selectedConnection.name} disabled readOnly />
                </FormField>
                <FormField label="Location">
                  <Input className="font-mono" value={connectionLocation(selectedConnection)} disabled readOnly />
                </FormField>
                <p className="text-xs text-text-faint">
                  This is the Prost application database, surfaced for inspection. It is read-only and cannot be edited
                  or deleted.
                </p>
              </div>
            ) : (
            <form className="flex flex-col gap-lg" onSubmit={(event) => event.preventDefault()}>
              <div>
                <button
                  type="button"
                  onClick={() => setImportOpen((prev) => !prev)}
                  className="text-xs text-accent hover:underline"
                >
                  {importOpen ? 'Hide' : 'Paste a connection string'}
                </button>
                {importOpen ? (
                  <div className="mt-sm flex gap-sm">
                    <Input
                      className="font-mono"
                      value={importValue}
                      onChange={(event) => setImportValue(event.target.value)}
                      placeholder="postgres://user:password@host:5432/database"
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={handleImport}>
                      Parse
                    </Button>
                  </div>
                ) : null}
              </div>

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
                    placeholder={placeholders.host}
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
                  placeholder={placeholders.database}
                />
              </FormField>

              <div className="h-px bg-border" />

              <div className="grid grid-cols-2 gap-md">
                <FormField label="User">
                  <Input
                    className="font-mono"
                    value={form.username}
                    onChange={(event) => updateField('username', event.target.value)}
                    placeholder={placeholders.username}
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

              <div className="flex flex-col gap-sm">
                <label className="flex w-max items-center gap-sm text-sm text-text">
                  <Checkbox
                    checked={form.sslEnabled}
                    onChange={(event) => updateField('sslEnabled', event.target.checked)}
                  />
                  Require SSL
                </label>
                {form.sslEnabled ? (
                  <label className="flex w-max items-center gap-sm pl-lg text-sm text-text">
                    <Checkbox
                      checked={form.sslRejectUnauthorized}
                      onChange={(event) => updateField('sslRejectUnauthorized', event.target.checked)}
                    />
                    Verify server certificate
                  </label>
                ) : null}
              </div>

              {testConnection.data ? (
                <Badge variant={testConnection.data.ok ? 'success' : 'danger'} className="w-max">
                  {testConnection.data.message}
                  {testConnection.data.serverVersion ? ` · ${engineLabel} ${testConnection.data.serverVersion}` : ''}
                </Badge>
              ) : null}
              {testConnection.isError ? (
                <Badge variant="danger" className="w-max">
                  {apiErrorMessage(testConnection.error, 'Connection test failed.')}
                </Badge>
              ) : null}
              {formError ? (
                <p className="text-xs text-danger" role="alert">
                  {formError}
                </p>
              ) : null}
            </form>
            )}
          </div>

          <Surface level="raised" className="flex h-16 shrink-0 items-center justify-between border-t border-border px-lg">
            {selectedReadOnly ? (
              <span />
            ) : (
              <Button variant="secondary" size="sm" onClick={handleTest} disabled={testConnection.isPending}>
                <Zap size={14} />
                {testConnection.isPending ? 'Testing…' : 'Test Connection'}
              </Button>
            )}
            <div className="flex items-center gap-md">
              {selectedId && !selectedReadOnly ? (
                <Button variant="secondary" size="sm" onClick={handleSave} disabled={updateConnection.isPending}>
                  <Save size={14} />
                  {updateConnection.isPending ? 'Saving…' : 'Save'}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleConnect} disabled={createConnection.isPending}>
                {createConnection.isPending ? 'Connecting…' : 'Connect'}
                <ArrowRight size={14} />
              </Button>
            </div>
          </Surface>
        </div>
      </Surface>
      {confirmDialog}
    </div>
  );
}
