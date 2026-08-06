import { useEffect, useState } from 'react';
import { ArrowRight, Cable, Database, Eye, EyeOff, Plus, Save, Trash2, X, Zap } from 'lucide-react';
import clsx from 'clsx';
import type {
  ConnectionDto,
  ConnectionEnvironment,
  DbEngine,
  DbEngineDescriptor,
  SshAuthMethod,
} from '@prost/shared-types';
import { CONNECTION_ENVIRONMENTS, isSystemConnectionId } from '@prost/shared-types';
import { parseConnectionString } from '@prost/utils';
import { Badge, Button, IconButton, Input, Modal, Surface, Switch } from '@prost/ui';
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
  environment: ConnectionEnvironment;
  readOnly: boolean;
  // SSH tunnel (Phase 32). `sshSecret`/`sshKeyPassphrase` are write-only — blank on edit, never fetched back.
  sshEnabled: boolean;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshAuthMethod: SshAuthMethod;
  sshSecret: string;
  sshKeyPassphrase: string;
  sshHostFingerprint: string;
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
  environment: 'dev',
  readOnly: false,
  sshEnabled: false,
  sshHost: '',
  sshPort: '22',
  sshUsername: '',
  sshAuthMethod: 'key',
  sshSecret: '',
  sshKeyPassphrase: '',
  sshHostFingerprint: '',
};

const ENVIRONMENT_LABELS: Record<ConnectionEnvironment, string> = {
  dev: 'Dev',
  staging: 'Staging',
  prod: 'Prod',
};

// Active-state colors per environment so dev/staging/prod are differentiated at a glance
// (dev = accent, staging = amber, prod = red) — matches the status-bar badges. Fixed palette
// colors so staging/prod never collapse to the same hue the way the danger/warning tokens do in dark mode.
const ENVIRONMENT_ACTIVE_STYLE: Record<ConnectionEnvironment, string> = {
  dev: 'border-accent bg-accent-muted text-accent',
  staging: 'border-amber-500 bg-amber-500/15 text-amber-600',
  prod: 'border-red-600 bg-red-600/15 text-red-600',
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
  supportsQueryPlan: true,
  supportsExplainAnalyze: true,
  supportsSessionMonitoring: true,
  supportsPerfInsights: true,
  ddl: {
    columnTypes: [],
    defaultExamples: [],
    indexMethods: [],
    supportsAutoIncrement: false,
    supportsUsingExpression: true,
    supportsForeignKeyDdl: true,
    supportsObjectComments: true,
  },
  objects: {
    views: false,
    materializedViews: false,
    sequences: false,
    functions: false,
    procedures: false,
    triggers: false,
    enums: false,
  },
};

function toFormState(connection: ConnectionDto): ConnectionFormState {
  const ssh = connection.ssh;
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
    environment: connection.environment,
    readOnly: connection.capabilities.readOnly,
    // Non-secret SSH fields hydrate; the key/password/passphrase stay blank (write-only, like the password).
    sshEnabled: ssh.sshEnabled,
    sshHost: ssh.sshHost ?? '',
    sshPort: String(ssh.sshPort ?? 22),
    sshUsername: ssh.sshUsername ?? '',
    sshAuthMethod: ssh.sshAuthMethod ?? 'key',
    sshSecret: '',
    sshKeyPassphrase: '',
    sshHostFingerprint: ssh.sshHostFingerprint ?? '',
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

  if (!open) return null;

  const descriptors = databaseEngines ?? [fallbackNetworkEngine];
  const networkEngines = descriptors.filter(
    (descriptor) => descriptor.connectionMode === 'network',
  );
  const selectedConnection = connections.find((c) => c.id === selectedId) ?? null;
  // The virtual app-DB self-connection is uneditable/undeletable and shown as an info panel. A
  // *user* connection with the read-only flag set is still a normal, editable/deletable connection.
  const isSystemConnection = selectedConnection
    ? isSystemConnectionId(selectedConnection.id)
    : false;
  const currentEngine = selectedConnection?.engine ?? form.engine;
  const currentEngineDescriptor = descriptors.find(
    (descriptor) => descriptor.engine === currentEngine,
  );
  const engineLabel =
    currentEngineDescriptor?.label ??
    `${currentEngine.charAt(0).toUpperCase()}${currentEngine.slice(1)}`;
  const placeholders = enginePlaceholders[form.engine] ?? enginePlaceholders.postgres;
  const showEnginePicker = !isSystemConnection && !selectedId && networkEngines.length >= 2;

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
    const { engine, host, port, database, username, password, sslEnabled, sslRejectUnauthorized } =
      result.value;
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
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return 'Port must be between 1 and 65535.';
    if (!form.database.trim()) return 'Database is required.';
    if (!form.username.trim()) return 'Username is required.';
    if (requirePassword && !form.password) return 'Password is required.';
    return null;
  }

  /** The SSH fields for a create/update/test payload — secrets omitted when blank (write-only, keep stored). */
  function sshPayload() {
    if (!form.sshEnabled) return { sshEnabled: false };
    return {
      sshEnabled: true,
      sshHost: form.sshHost,
      sshPort: Number(form.sshPort),
      sshUsername: form.sshUsername,
      sshAuthMethod: form.sshAuthMethod,
      ...(form.sshSecret ? { sshSecret: form.sshSecret } : {}),
      ...(form.sshAuthMethod === 'key' && form.sshKeyPassphrase
        ? { sshKeyPassphrase: form.sshKeyPassphrase }
        : {}),
    };
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
      ...sshPayload(),
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
          environment: form.environment,
          readOnly: form.readOnly,
          ...sshPayload(),
        },
      },
      {
        onSuccess: () =>
          setForm((prev) => ({ ...prev, password: '', sshSecret: '', sshKeyPassphrase: '' })),
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
        environment: form.environment,
        readOnly: form.readOnly,
        ...sshPayload(),
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
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Connection"
        hideTitle
        className="relative w-full max-w-3xl overflow-hidden md:max-h-[90vh] md:flex-row max-md:h-full max-md:max-w-none max-md:rounded-none"
      >
        <IconButton
          aria-label="Close"
          title="Close"
          onClick={onClose}
          className="absolute right-3 top-6 z-10 -translate-y-1/2"
        >
          <X size={16} />
        </IconButton>
        <div className="flex h-1/3 shrink-0 flex-col border-b border-border md:h-full md:w-1/3 md:border-b-0 md:border-r">
          <Surface
            level="raised"
            className="flex h-12 shrink-0 items-center border-b border-border px-lg"
          >
            <Database size={18} className="mr-sm text-accent" />
            <span className="text-sm font-semibold text-text">Connections</span>
          </Surface>
          <div className="mt-sm flex items-center justify-between px-md py-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-text-faint">
              Recent
            </span>
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
                selectedId === null
                  ? 'bg-accent-muted text-accent'
                  : 'text-text hover:bg-surface-hover',
              )}
            >
              <Plus
                size={16}
                className={clsx(
                  'shrink-0',
                  selectedId === null ? 'text-accent' : 'text-text-faint',
                )}
              />
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
                        isSelected
                          ? 'bg-accent-muted text-accent'
                          : 'text-text hover:bg-surface-hover',
                      )}
                    >
                      <Cable
                        size={16}
                        className={clsx('shrink-0', isSelected ? 'text-accent' : 'text-text-faint')}
                      />
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
                    {isSystemConnectionId(connection.id) ? null : (
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
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg md:pr-14">
            <span className="text-sm font-semibold text-text">
              {isSystemConnection
                ? 'Connection'
                : selectedId
                  ? 'Edit Connection'
                  : 'New Connection'}
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
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-lg">
            {isSystemConnection && selectedConnection ? (
              <div className="flex flex-col gap-lg">
                <FormField label="Connection Name">
                  <Input value={selectedConnection.name} disabled readOnly />
                </FormField>
                <FormField label="Location">
                  <Input
                    className="font-mono"
                    value={connectionLocation(selectedConnection)}
                    disabled
                    readOnly
                  />
                </FormField>
                <p className="text-xs text-text-faint">
                  This is the Prost application database, surfaced for inspection. It is read-only
                  and cannot be edited or deleted.
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
                  <Input
                    value={form.name}
                    onChange={(event) => updateField('name', event.target.value)}
                    placeholder="My Database"
                  />
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

                <div className="grid grid-cols-2 gap-md max-md:grid-cols-1">
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
                    <Switch
                      checked={form.sslEnabled}
                      onChange={(event) => updateField('sslEnabled', event.target.checked)}
                    />
                    Require SSL
                  </label>
                  {form.sslEnabled ? (
                    <label className="flex w-max items-center gap-sm pl-lg text-sm text-text">
                      <Switch
                        checked={form.sslRejectUnauthorized}
                        onChange={(event) =>
                          updateField('sslRejectUnauthorized', event.target.checked)
                        }
                      />
                      Verify server certificate
                    </label>
                  ) : null}
                </div>

                {/* SSH tunnel (Phase 32) — reach a DB behind a bastion. Mirrors the SSL toggle-reveals-fields pattern. */}
                <div className="flex flex-col gap-sm">
                  <label className="flex w-max items-center gap-sm text-sm text-text">
                    <Switch
                      checked={form.sshEnabled}
                      onChange={(event) => updateField('sshEnabled', event.target.checked)}
                    />
                    Connect via SSH
                  </label>
                  {form.sshEnabled ? (
                    <div className="flex flex-col gap-md pl-lg">
                      <div className="grid grid-cols-4 gap-md">
                        <FormField label="SSH Host" className="col-span-2">
                          <Input
                            className="font-mono"
                            value={form.sshHost}
                            onChange={(e) => updateField('sshHost', e.target.value)}
                            placeholder="bastion.example.com"
                          />
                        </FormField>
                        <FormField label="Port">
                          <Input
                            className="font-mono"
                            value={form.sshPort}
                            onChange={(e) => updateField('sshPort', e.target.value)}
                            placeholder="22"
                          />
                        </FormField>
                        <FormField label="SSH User">
                          <Input
                            className="font-mono"
                            value={form.sshUsername}
                            onChange={(e) => updateField('sshUsername', e.target.value)}
                            placeholder="jump"
                          />
                        </FormField>
                      </div>

                      <FormField label="Authentication">
                        <div className="flex gap-xs">
                          {(['key', 'password'] as SshAuthMethod[]).map((method) => (
                            <button
                              key={method}
                              type="button"
                              onClick={() => updateField('sshAuthMethod', method)}
                              className={clsx(
                                'flex-1 rounded-sm border px-sm py-1.5 text-xs font-medium transition-colors',
                                form.sshAuthMethod === method
                                  ? 'border-accent bg-accent-muted text-accent'
                                  : 'border-border text-text-muted hover:bg-surface-hover hover:text-text',
                              )}
                            >
                              {method === 'key' ? 'Private key' : 'Password'}
                            </button>
                          ))}
                        </div>
                      </FormField>

                      {form.sshAuthMethod === 'key' ? (
                        <>
                          <FormField label="Private key">
                            <div className="flex flex-col gap-xs">
                              <textarea
                                value={form.sshSecret}
                                onChange={(e) => updateField('sshSecret', e.target.value)}
                                placeholder={
                                  selectedId && form.sshHostFingerprint
                                    ? '•••••••• (stored — paste to replace)'
                                    : '-----BEGIN OPENSSH PRIVATE KEY-----'
                                }
                                rows={3}
                                className="w-full resize-none rounded-sm border border-border bg-surface px-sm py-xs font-mono text-xs text-text placeholder-text-faint focus:border-accent focus:outline-none"
                              />
                              <label className="flex w-max cursor-pointer items-center gap-xs text-xs text-accent hover:underline">
                                Upload key file…
                                <input
                                  type="file"
                                  accept=".pem,.key,text/plain"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file)
                                      void file
                                        .text()
                                        .then((text) => updateField('sshSecret', text));
                                  }}
                                />
                              </label>
                            </div>
                          </FormField>
                          <FormField label="Key passphrase (optional)">
                            <Input
                              type="password"
                              className="font-mono"
                              value={form.sshKeyPassphrase}
                              onChange={(e) => updateField('sshKeyPassphrase', e.target.value)}
                              placeholder={selectedId ? '•••••••• (leave blank to keep)' : ''}
                            />
                          </FormField>
                        </>
                      ) : (
                        <FormField label="SSH password">
                          <Input
                            type="password"
                            className="font-mono"
                            value={form.sshSecret}
                            onChange={(e) => updateField('sshSecret', e.target.value)}
                            placeholder={selectedId ? '••••••••' : ''}
                          />
                        </FormField>
                      )}

                      {form.sshHostFingerprint ? (
                        <p className="text-xs text-text-faint">
                          Trusted host key:{' '}
                          <span className="font-mono">{form.sshHostFingerprint}</span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="h-px bg-border" />

                <div className="flex flex-col gap-sm">
                  <FormField label="Environment">
                    <div className="flex gap-xs">
                      {CONNECTION_ENVIRONMENTS.map((env) => (
                        <button
                          key={env}
                          type="button"
                          onClick={() => updateField('environment', env)}
                          className={clsx(
                            'flex-1 rounded-sm border px-sm py-1.5 text-xs font-medium transition-colors',
                            form.environment === env
                              ? ENVIRONMENT_ACTIVE_STYLE[env]
                              : 'border-border text-text-muted hover:bg-surface-hover hover:text-text',
                          )}
                        >
                          {ENVIRONMENT_LABELS[env]}
                        </button>
                      ))}
                    </div>
                  </FormField>
                  <label className="flex w-max items-center gap-sm text-sm text-text">
                    <Switch
                      checked={form.readOnly}
                      onChange={(event) => updateField('readOnly', event.target.checked)}
                    />
                    Read-only (block all writes on this connection)
                  </label>
                </div>

                {testConnection.data ? (
                  <Badge variant={testConnection.data.ok ? 'success' : 'danger'} className="w-max">
                    {/* Prefix a failure with the stage so SSH vs DB errors are unmistakable (Phase 32). */}
                    {!testConnection.data.ok && testConnection.data.stage === 'ssh' ? 'SSH: ' : ''}
                    {testConnection.data.message}
                    {testConnection.data.serverVersion
                      ? ` · ${engineLabel} ${testConnection.data.serverVersion}`
                      : ''}
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

          <Surface
            level="raised"
            className="flex h-16 shrink-0 items-center justify-between border-t border-border px-lg max-md:gap-sm max-md:px-md"
          >
            {isSystemConnection ? (
              <span />
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleTest}
                disabled={testConnection.isPending}
                className="shrink-0"
              >
                <Zap size={14} />
                {testConnection.isPending ? (
                  'Testing…'
                ) : (
                  <>
                    Test<span className="max-md:hidden"> Connection</span>
                  </>
                )}
              </Button>
            )}
            <div className="flex items-center gap-md max-md:gap-sm">
              {selectedId && !isSystemConnection ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleSave}
                  disabled={updateConnection.isPending}
                >
                  <Save size={14} />
                  {updateConnection.isPending ? 'Saving…' : 'Save'}
                </Button>
              ) : null}
              <Button
                variant="primary"
                size="sm"
                onClick={handleConnect}
                disabled={createConnection.isPending}
              >
                {createConnection.isPending ? 'Connecting…' : 'Connect'}
                <ArrowRight size={14} />
              </Button>
            </div>
          </Surface>
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}
