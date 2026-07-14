import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, ExternalLink, Plus, RefreshCw, Save, Sparkles, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import type { LlmEndpointDto } from '@prost/shared-types';
import { Badge, Button, IconButton, Input, Surface } from '@prost/ui';
import {
  useCreateLlmEndpoint,
  useDeleteLlmEndpoint,
  useLlmEndpoints,
  useProbeLlmEndpoint,
  useUpdateLlmEndpoint,
} from '../api/ai';
import { FormField } from '../components/FormField';
import { useConfirm } from '../hooks/useConfirm';
import { apiErrorDetail } from '../lib/apiClient';
import { llmPresets, type LlmPreset } from './llmPresets';

export interface LlmEndpointsModalProps {
  open: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string;
  /** Schema-context budget in characters; empty string → server default. */
  contextBudget: string;
}

const blankForm: FormState = {
  name: '',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  models: '',
  contextBudget: '',
};

function toFormState(endpoint: LlmEndpointDto): FormState {
  return {
    name: endpoint.name,
    baseUrl: endpoint.baseUrl,
    apiKey: '',
    models: endpoint.models.join('\n'),
    contextBudget: endpoint.contextBudget != null ? String(endpoint.contextBudget) : '',
  };
}

/** Parses the context-budget field to a number, or null when blank/invalid (→ server default). */
function parseBudget(raw: string): number | null {
  const n = Number(raw.trim());
  return raw.trim() && Number.isFinite(n) && n >= 500 ? Math.round(n) : null;
}

function parseModels(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

export function LlmEndpointsModal({ open, onClose }: LlmEndpointsModalProps) {
  const { data: endpoints = [], isLoading } = useLlmEndpoints();
  const createEndpoint = useCreateLlmEndpoint();
  const updateEndpoint = useUpdateLlmEndpoint();
  const deleteEndpoint = useDeleteLlmEndpoint();
  const probe = useProbeLlmEndpoint();
  const { confirm, dialog: confirmDialog } = useConfirm();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [formError, setFormError] = useState<string | null>(null);
  // In new-endpoint mode, the provider card grid shows until a preset (or
  // "Custom endpoint") is chosen. `activePreset` drives the API-key hints.
  const [presetChosen, setPresetChosen] = useState(false);
  const [activePreset, setActivePreset] = useState<LlmPreset | null>(null);

  useEffect(() => {
    if (open) return;
    setSelectedId(null);
    setForm(blankForm);
    setFormError(null);
    setPresetChosen(false);
    setActivePreset(null);
    createEndpoint.reset();
    updateEndpoint.reset();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function selectEndpoint(endpoint: LlmEndpointDto) {
    setSelectedId(endpoint.id);
    setForm(toFormState(endpoint));
    setFormError(null);
    setPresetChosen(true);
    setActivePreset(null);
  }

  function startNew() {
    setSelectedId(null);
    setForm(blankForm);
    setFormError(null);
    setPresetChosen(false);
    setActivePreset(null);
  }

  function choosePreset(preset: LlmPreset) {
    setForm({
      name: preset.name,
      baseUrl: preset.baseUrl,
      apiKey: '',
      models: preset.models.join('\n'),
      contextBudget: '',
    });
    setActivePreset(preset);
    setPresetChosen(true);
    setFormError(null);
  }

  function chooseCustom() {
    setForm(blankForm);
    setActivePreset(null);
    setPresetChosen(true);
    setFormError(null);
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Name is required.';
    if (!form.baseUrl.trim()) return 'Base URL is required.';
    if (parseModels(form.models).length === 0) return 'Add at least one model.';
    if (!selectedId && !form.apiKey) return 'API key is required (use any placeholder for keyless servers).';
    return null;
  }

  function handleSave() {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const models = parseModels(form.models);

    const contextBudget = parseBudget(form.contextBudget);

    if (selectedId) {
      updateEndpoint.mutate(
        {
          id: selectedId,
          body: {
            name: form.name.trim(),
            baseUrl: form.baseUrl.trim(),
            models,
            contextBudget,
            ...(form.apiKey ? { apiKey: form.apiKey } : {}),
          },
        },
        {
          onSuccess: () => setForm((prev) => ({ ...prev, apiKey: '' })),
          onError: (err) => setFormError(apiErrorDetail(err, 'Failed to save endpoint.')),
        },
      );
    } else {
      createEndpoint.mutate(
        { name: form.name.trim(), baseUrl: form.baseUrl.trim(), apiKey: form.apiKey, models, contextBudget },
        {
          onSuccess: (created) => selectEndpoint(created),
          onError: (err) => setFormError(apiErrorDetail(err, 'Failed to add endpoint.')),
        },
      );
    }
  }

  function handleFetchModels() {
    if (!form.baseUrl.trim()) {
      setFormError('Enter a base URL first.');
      return;
    }
    setFormError(null);
    probe.mutate(
      { baseUrl: form.baseUrl.trim(), apiKey: form.apiKey },
      {
        onSuccess: (result) => {
          setForm((prev) => ({
            ...prev,
            models: result.models.length > 0 ? result.models.join('\n') : prev.models,
            // Convert the reported window (tokens) to a conservative char budget (~half the window).
            contextBudget:
              result.contextLength != null ? String(result.contextLength * 2) : prev.contextBudget,
          }));
          if (result.models.length === 0) {
            setFormError('Endpoint returned no models. Enter them manually.');
          }
        },
        onError: (err) => setFormError(apiErrorDetail(err, 'Could not reach the endpoint.')),
      },
    );
  }

  async function handleDelete(endpoint: LlmEndpointDto) {
    const confirmed = await confirm({
      title: 'Delete endpoint',
      description: `Delete "${endpoint.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    deleteEndpoint.mutate(endpoint.id, {
      onSuccess: () => {
        if (selectedId === endpoint.id) startNew();
      },
      onError: (err) => setFormError(apiErrorDetail(err, 'Failed to delete endpoint.')),
    });
  }

  const saving = createEndpoint.isPending || updateEndpoint.isPending;
  const showGrid = !selectedId && !presetChosen;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md">
      <Surface
        level="overlay"
        bordered
        className="flex h-[min(560px,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-lg shadow-2xl md:flex-row"
      >
        {/* List pane */}
        <div className="flex h-1/3 shrink-0 flex-col border-b border-border md:h-full md:w-1/3 md:border-b-0 md:border-r">
          <Surface level="raised" className="flex h-12 shrink-0 items-center border-b border-border px-lg">
            <Bot size={18} className="mr-sm text-accent" />
            <span className="text-sm font-semibold text-text">LLM Endpoints</span>
          </Surface>
          <div className="mt-sm flex items-center justify-between px-md py-sm">
            <span className="text-xs font-medium uppercase tracking-wider text-text-faint">Saved</span>
            <IconButton aria-label="New endpoint" onClick={startNew}>
              <Plus size={16} />
            </IconButton>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto px-xs py-xs">
            {isLoading ? (
              <p className="px-sm py-2 text-xs italic text-text-faint">Loading…</p>
            ) : endpoints.length === 0 ? (
              <p className="px-sm py-2 text-xs italic text-text-faint">No endpoints yet.</p>
            ) : (
              endpoints.map((endpoint) => {
                const isSelected = endpoint.id === selectedId;
                return (
                  <div key={endpoint.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => selectEndpoint(endpoint)}
                      className={clsx(
                        'flex w-full items-center gap-sm rounded-sm border border-transparent p-sm pr-8 text-left transition-colors',
                        isSelected ? 'bg-accent-muted text-accent' : 'text-text hover:bg-surface-hover',
                      )}
                    >
                      <Bot size={16} className={isSelected ? 'text-accent' : 'text-text-faint'} />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{endpoint.name}</span>
                        <span className="truncate font-mono text-xs text-text-faint">
                          {endpoint.models.length} model{endpoint.models.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </button>
                    <IconButton
                      aria-label={`Delete ${endpoint.name}`}
                      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDelete(endpoint);
                      }}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Form pane */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-lg">
            <span className="text-sm font-semibold text-text">{selectedId ? 'Edit Endpoint' : 'New Endpoint'}</span>
            <div className="flex items-center gap-sm">
              <Badge variant="accent">OpenAI-compatible</Badge>
              <IconButton aria-label="Close" onClick={onClose}>
                <X size={16} />
              </IconButton>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-lg">
            {showGrid ? (
              <div className="flex flex-col gap-md">
                <p className="text-xs text-text-faint">
                  Pick a provider to prefill its base URL and models — then just add your API key.
                </p>
                <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
                  {llmPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => choosePreset(preset)}
                      className="flex flex-col items-start gap-1 rounded-sm border border-border bg-surface p-sm text-left transition-colors hover:border-accent hover:bg-surface-hover"
                    >
                      <span className="flex items-center gap-xs text-sm font-medium text-text">
                        <Bot size={15} className="text-accent" />
                        {preset.name}
                      </span>
                      <span className="truncate text-xs text-text-faint">
                        {preset.keyless ? 'Local' : `${preset.models.length} models`}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={chooseCustom}
                  className="flex items-center gap-xs rounded-sm border border-dashed border-border bg-surface p-sm text-sm text-text-muted transition-colors hover:border-accent hover:text-text"
                >
                  <Sparkles size={15} className="text-text-faint" />
                  Custom endpoint
                </button>
              </div>
            ) : (
              <form className="flex flex-col gap-lg" onSubmit={(event) => event.preventDefault()}>
                {!selectedId ? (
                  <button
                    type="button"
                    onClick={startNew}
                    className="flex items-center gap-xs self-start text-xs text-accent hover:underline"
                  >
                    <ArrowLeft size={12} />
                    Choose a different provider
                  </button>
                ) : null}

                <FormField label="Name">
                  <Input value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="My OpenAI" />
                </FormField>

                <FormField label="Base URL">
                  <Input
                    className="font-mono"
                    value={form.baseUrl}
                    onChange={(e) => updateField('baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </FormField>

                <FormField label="API Key">
                  <Input
                    className="font-mono"
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => updateField('apiKey', e.target.value)}
                    placeholder={
                      selectedId
                        ? 'leave blank to keep current'
                        : activePreset?.keyless
                          ? 'any value (local server needs no key)'
                          : 'sk-…'
                    }
                  />
                  {activePreset?.apiKeyUrl ? (
                    <a
                      href={activePreset.apiKeyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 flex w-fit items-center gap-xs text-xs text-accent hover:underline"
                    >
                      Get an API key
                      <ExternalLink size={11} />
                    </a>
                  ) : null}
                </FormField>

                <FormField label="Models (one per line, or comma-separated)">
                  <div className="mb-1 flex justify-end">
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={probe.isPending}
                      className="flex items-center gap-xs text-xs text-accent hover:underline disabled:opacity-50"
                    >
                      <RefreshCw size={11} className={probe.isPending ? 'animate-spin' : ''} />
                      {probe.isPending ? 'Fetching…' : 'Fetch from endpoint'}
                    </button>
                  </div>
                  <textarea
                    value={form.models}
                    onChange={(e) => updateField('models', e.target.value)}
                    rows={4}
                    placeholder={'gpt-4o\ngpt-4o-mini'}
                    className="w-full resize-y rounded-sm border border-border bg-surface px-sm py-xs font-mono text-xs text-text placeholder-text-faint focus:border-accent focus:outline-none"
                  />
                </FormField>

                <FormField label="Context budget (characters, optional)">
                  <Input
                    type="number"
                    value={form.contextBudget}
                    onChange={(e) => updateField('contextBudget', e.target.value)}
                    placeholder="server default (~24000)"
                  />
                  <p className="mt-1 text-xs text-text-faint">
                    Max schema context sent to the model. Prefilled from the endpoint when it reports a
                    context window; leave blank to use the server default.
                  </p>
                </FormField>

                {formError ? (
                  <p className="text-xs text-danger" role="alert">
                    {formError}
                  </p>
                ) : null}
              </form>
            )}
          </div>

          <Surface level="raised" className="flex h-16 shrink-0 items-center justify-end gap-md border-t border-border px-lg">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            {showGrid ? null : (
              <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                <Save size={14} />
                {saving ? 'Saving…' : selectedId ? 'Save' : 'Add Endpoint'}
              </Button>
            )}
          </Surface>
        </div>
      </Surface>
      {confirmDialog}
    </div>
  );
}
